// Work domain: manual client requests and internal tasks. The only entry point for these writes.
// Every function takes an actor, checks permission, validates, writes, then writes an audit row.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { parseInput } from "@/platform/auth/schemas";
import { writeAudit } from "@/platform/audit/audit";
import { toLocalDate } from "@/platform/calendar/business-days";
import { createUserClient } from "@/platform/db/server";
import { RuleError } from "@/platform/errors";
import { getCalendar } from "@/domains/admin/service";
import { completionFields, duplicateWindowStart, taskSourceReference } from "./rules";
import { createRequestSchema, createTaskSchema, taskStatusSchema } from "./schemas";
import * as repo from "./repo";
import type { ClientOption, CreatedRequest, CreatedTask, WorkOverview } from "./types";

type Owner = Extract<Actor, { type: "owner" }>;

export async function getWorkOverview(actor: Actor): Promise<WorkOverview> {
  assertCan(actor, "work.read");
  const { timeZone } = await getCalendar(actor);
  const today = toLocalDate(new Date(), timeZone);
  const db = await createUserClient();
  const [tasks, requests] = await Promise.all([repo.listOpenTasks(db, today), repo.listOpenRequests(db)]);
  return { today, tasks, requests };
}

export async function listClientOptions(actor: Actor): Promise<ClientOption[]> {
  assertCan(actor, "clients.read");
  return repo.listClientOptions(await createUserClient());
}

export async function createRequest(actor: Owner, raw: unknown): Promise<CreatedRequest> {
  assertCan(actor, "work.write");
  const input = parseInput(createRequestSchema, raw);
  const db = await createUserClient();

  const clientName = await repo.getClientName(db, input.clientId);
  if (clientName === null) throw new RuleError("That client could not be found.");
  if (input.websiteUrl && !(await repo.clientHasWebsite(db, input.clientId, input.websiteUrl))) {
    throw new RuleError("That website is not recorded for this client.");
  }

  // A double-tap or retry sends the same request again: return the one already saved.
  const existing = await repo.findRecentRequest(db, input.clientId, input.title, duplicateWindowStart(new Date()));
  if (existing) return { ...existing, duplicate: true };

  // Service role is used only to get the next request number. The insert runs as the owner.
  let saved: { id: string; displayId: string } | null = null;
  for (let attempt = 0; attempt < 2 && !saved; attempt++) {
    const displayId = await repo.nextRequestDisplayId();
    try {
      saved = await repo.insertRequest(db, {
        displayId,
        clientId: input.clientId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        source: input.source,
        websiteUrl: input.websiteUrl,
      });
    } catch (e) {
      // 23505 = that number is already taken. Ask for a new one once, then give up.
      if (!(e instanceof repo.RepoError && e.code === "23505") || attempt === 1) throw e;
    }
  }
  if (!saved) throw new RuleError("The request could not be saved. Please try again.");

  await writeAudit(actor, {
    action: "request.created",
    entityType: "request",
    entityId: saved.id,
    clientId: input.clientId,
    after: {
      displayId: saved.displayId,
      title: input.title,
      clientName,
      priority: input.priority,
      source: input.source,
      websiteUrl: input.websiteUrl,
      origin: "quick-add",
    },
  });
  return { ...saved, duplicate: false };
}

export async function createTask(actor: Owner, raw: unknown): Promise<CreatedTask> {
  assertCan(actor, "work.write");
  const input = parseInput(createTaskSchema, raw);
  const db = await createUserClient();

  if (input.clientId && (await repo.getClientName(db, input.clientId)) === null) {
    throw new RuleError("That client could not be found.");
  }

  const sourceReference = taskSourceReference(input.submissionKey);
  const existing = await repo.findTaskBySource(db, sourceReference);
  if (existing) return { id: existing.id, duplicate: true };

  const saved = await repo.insertTask(db, {
    title: input.title,
    description: input.description,
    clientId: input.clientId,
    priority: input.priority,
    dueDate: input.dueDate,
    sourceReference,
  });
  await writeAudit(actor, {
    action: "task.created",
    entityType: "internal_work_item",
    entityId: saved.id,
    clientId: input.clientId,
    after: { title: input.title, priority: input.priority, dueDate: input.dueDate, origin: "quick-add" },
  });
  return { id: saved.id, duplicate: false };
}

export async function setTaskStatus(actor: Owner, raw: unknown): Promise<void> {
  assertCan(actor, "work.write");
  const input = parseInput(taskStatusSchema, raw);
  const db = await createUserClient();
  const before = await repo.getTask(db, input.id);
  if (!before) throw new RuleError("That task could not be found.");
  if (before.status === input.status) return;

  await repo.updateTaskStatus(db, input.id, input.status, completionFields(input.status, new Date()).completed_at);
  await writeAudit(actor, {
    action: "task.status_changed",
    entityType: "internal_work_item",
    entityId: input.id,
    clientId: before.client_id,
    before: { status: before.status },
    after: { status: input.status, title: before.title },
  });
}
