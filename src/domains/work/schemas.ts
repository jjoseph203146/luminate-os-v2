import { z } from "zod";
import { isValidIsoDate } from "@/platform/calendar/business-days";
import { REQUEST_PRIORITIES, REQUEST_SOURCES, TASK_PRIORITIES, TASK_STATUSES } from "./types";

const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : typeof v === "string" ? v.trim() : v;

const optionalText = (max: number) => z.preprocess(blankToNull, z.string().max(max, `Use at most ${max} characters.`).nullable());

const title = z.string().trim().min(3, "Give it a title of at least 3 characters.").max(200, "Use at most 200 characters.");

export const createRequestSchema = z.object({
  clientId: z.string().trim().pipe(z.uuid("Pick a client.")),
  title,
  description: optionalText(4000),
  priority: z.preprocess(blankToNull, z.enum(REQUEST_PRIORITIES).nullable()),
  source: z.preprocess(blankToNull, z.enum(REQUEST_SOURCES).nullable()),
  websiteUrl: optionalText(2048),
});
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const createTaskSchema = z.object({
  title,
  description: optionalText(4000),
  clientId: z.preprocess(blankToNull, z.uuid("Pick a valid client.").nullable()),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  dueDate: z.preprocess(
    blankToNull,
    z.string().refine(isValidIsoDate, "Enter the due date as a real date.").nullable(),
  ),
  /** Random value made when the form opens, so a retried submit cannot create the task twice. */
  submissionKey: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9-]+$/, "Reload the form and try again."),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const taskStatusSchema = z.object({
  id: z.string().trim().pipe(z.uuid()),
  status: z.enum(TASK_STATUSES),
});
export type TaskStatusInput = z.infer<typeof taskStatusSchema>;
