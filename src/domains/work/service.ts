// Work domain: manual client requests and internal tasks. The only entry point for these writes.
// Every function takes an actor, checks permission, validates, writes, then writes an audit row.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { parseInput } from "@/platform/auth/schemas";
import { writeAudit } from "@/platform/audit/audit";
import { stampActor } from "@/platform/audit/stamp";
import { toLocalDate } from "@/platform/calendar/business-days";
import { createAdminClient, createUserClient, readDb } from "@/platform/db/server";
import { PermissionError, RuleError } from "@/platform/errors";
import { getCalendar } from "@/domains/admin/service";
import { completionFields, duplicateWindowStart, taskSourceReference } from "./rules";
import { createRequestSchema, createTaskSchema, requestCommentSchema, taskStatusSchema, updateTaskSchema } from "./schemas";
import * as repo from "./repo";
import type { ClientOption, CreatedRequest, CreatedTask, WorkOverview } from "./types";

type WorkWriter = Extract<Actor, { type: "owner" | "bot" }>;

function assertWorkWriter(actor: Actor): asserts actor is WorkWriter {
  assertCan(actor, "work.write");
  if (actor.type !== "owner" && actor.type !== "bot") throw new PermissionError();
}

/** The owner writes through row-level security. A bot has no session, so it uses the service role after the permission check. */
async function workDb(actor: WorkWriter) {
  return actor.type === "owner" ? createUserClient() : createAdminClient();
}

export async function getWorkOverview(actor: Actor): Promise<WorkOverview> {
  assertCan(actor, "work.read");
  const { timeZone } = await getCalendar(actor);
  const today = toLocalDate(new Date(), timeZone);
  const db = await readDb(actor);
  const [tasks, requests, projects] = await Promise.all([repo.listOpenTasks(db, today), repo.listOpenRequests(db), repo.listProjects(db)]);
  return { today, tasks, requests, projects };
}

export async function listClientOptions(actor: Actor): Promise<ClientOption[]> {
  assertCan(actor, "clients.read");
  return repo.listClientOptions(await createUserClient());
}

export async function createRequest(actor: Actor, raw: unknown): Promise<CreatedRequest> {
  assertWorkWriter(actor);
  const input = parseInput(createRequestSchema, raw);
  const db = await workDb(actor);

  const clientName = await repo.getClientName(db, input.clientId);
  if (clientName === null) throw new RuleError("That client could not be found.");
  if (input.websiteUrl && !(await repo.clientHasWebsite(db, input.clientId, input.websiteUrl))) {
    throw new RuleError("That website is not recorded for this client.");
  }

  // A double-tap or retry sends the same request again: return the one already saved.
  const existing = await repo.findRecentRequest(db, input.clientId, input.title, duplicateWindowStart(new Date()));
  if (existing) return { ...existing, duplicate: true, coverageStored: null };

  // Service role is used only to get the next request number. The insert runs as the caller (owner session, or service role for a bot).
  let saved: { id: string; displayId: string; coverageStored: boolean } | null = null;
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
        status: input.status,
        completedAt: input.status === "completed" ? new Date().toISOString() : null,
        coverage: input.coverage,
        price: input.price,
      });
    } catch (e) {
      // 23505 = that number is already taken. Ask for a new one once, then give up.
      if (!(e instanceof repo.RepoError && e.code === "23505") || attempt === 1) throw e;
    }
  }
  if (!saved) throw new RuleError("The request could not be saved. Please try again.");

  const after: Record<string, unknown> = {
    displayId: saved.displayId,
    title: input.title,
    clientName,
    priority: input.priority,
    source: input.source,
    websiteUrl: input.websiteUrl,
    origin: actor.type === "bot" ? "bot" : "quick-add",
  };
  if (input.coverage) {
    after.coverage = input.coverage;
    after.status = input.status ?? "new";
    after.price = input.coverage === "addon" ? input.price : null;
    if (!saved.coverageStored) after.coverageStored = false;
  }
  await writeAudit(actor, {
    action: "request.created",
    entityType: "request",
    entityId: saved.id,
    clientId: input.clientId,
    after: stampActor(actor, after),
  });
  return { id: saved.id, displayId: saved.displayId, duplicate: false, coverageStored: input.coverage ? saved.coverageStored : null };
}

export async function addRequestComment(actor: Actor, raw: unknown): Promise<{ id: string }> {
  assertWorkWriter(actor);
  const input = parseInput(requestCommentSchema, raw);
  const db = await workDb(actor);
  const request = await repo.getRequestClient(db, input.requestId);
  if (!request) throw new RuleError("That request could not be found.");
  const saved = await repo.insertComment(db, { requestId: request.id, clientId: request.client_id, body: input.body });
  // The comment text stays on the row. The audit row records who wrote it and how long it was.
  await writeAudit(actor, {
    action: "request.comment_added",
    entityType: "request_comment",
    entityId: saved.id,
    clientId: request.client_id,
    after: stampActor(actor, { requestId: request.id, length: input.body.length }),
  });
  return saved;
}

export async function createTask(actor: Actor, raw: unknown, opts?: { sourceReference?: string }): Promise<CreatedTask> {
  assertWorkWriter(actor);
  const input = parseInput(createTaskSchema, raw);
  const db = await workDb(actor);

  if (input.clientId && (await repo.getClientName(db, input.clientId)) === null) {
    throw new RuleError("That client could not be found.");
  }

  const sourceReference = opts?.sourceReference ?? taskSourceReference(input.submissionKey);
  if (sourceReference.length > 200 || /\s/.test(sourceReference)) throw new RuleError("That task key is not valid.");
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
    after: stampActor(actor, { title: input.title, priority: input.priority, dueDate: input.dueDate, origin: actor.type === "bot" ? "bot" : "quick-add" }),
  });
  return { id: saved.id, duplicate: false };
}

export async function updateTask(actor: Actor, raw: unknown): Promise<{ id: string; changed: string[] }> {
  assertWorkWriter(actor);
  const input = parseInput(updateTaskSchema, raw);
  const db = await workDb(actor);
  const before = await repo.getTask(db, input.id);
  if (!before) throw new RuleError("That task could not be found.");
  if (input.clientId && (await repo.getClientName(db, input.clientId)) === null) throw new RuleError("That client could not be found.");

  const patch: Record<string, string | null> = {};
  const changed: string[] = [];
  if (input.title !== undefined && input.title !== before.title) {
    patch.title = input.title;
    changed.push("title");
  }
  if (input.description !== undefined && input.description !== before.description) {
    patch.description = input.description;
    changed.push("description");
  }
  if (input.clientId !== undefined && input.clientId !== before.client_id) {
    patch.client_id = input.clientId;
    changed.push("clientId");
  }
  if (input.priority !== undefined && input.priority !== before.priority) {
    patch.priority = input.priority;
    changed.push("priority");
  }
  if (input.dueDate !== undefined && input.dueDate !== before.due_date) {
    patch.due_date = input.dueDate;
    changed.push("dueDate");
  }
  if (input.status !== undefined && input.status !== before.status) {
    patch.status = input.status;
    patch.completed_at = completionFields(input.status, new Date()).completed_at;
    changed.push("status");
  }
  if (changed.length === 0) return { id: input.id, changed };

  await repo.updateTask(db, input.id, patch);
  await writeAudit(actor, {
    action: "task.updated",
    entityType: "internal_work_item",
    entityId: input.id,
    clientId: input.clientId !== undefined ? input.clientId : before.client_id,
    before: { status: before.status },
    after: stampActor(actor, { changed, status: patch.status ?? before.status }),
  });
  return { id: input.id, changed };
}

export async function setTaskStatus(actor: Actor, raw: unknown): Promise<void> {
  assertWorkWriter(actor);
  const input = parseInput(taskStatusSchema, raw);
  const db = await workDb(actor);
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
    after: stampActor(actor, { status: input.status, title: before.title }),
  });
}
