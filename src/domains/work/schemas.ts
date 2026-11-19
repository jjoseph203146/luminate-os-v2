import { z } from "zod";
import { isValidIsoDate } from "@/platform/calendar/business-days";
import { REQUEST_COVERAGE, REQUEST_PRIORITIES, REQUEST_SOURCES, REQUEST_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from "./types";

const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : typeof v === "string" ? v.trim() : v;

const optionalText = (max: number) => z.preprocess(blankToNull, z.string().max(max, `Use at most ${max} characters.`).nullable());

const title = z.string().trim().min(3, "Give it a title of at least 3 characters.").max(200, "Use at most 200 characters.");

/** Dollars, optional. Blank becomes null. A number from JSON is accepted as well as "150" or "$150.00". */
const price = z.preprocess((v) => {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string") return v.trim().replace(/^\$/, "").replace(/,/g, "");
  return v;
}, z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter the price as a number of dollars, like 150 or 150.50.").transform(Number).pipe(z.number().max(1_000_000, "That price looks too large.")).nullable());

export const createRequestSchema = z
  .object({
    clientId: z.string().trim().pipe(z.uuid("Pick a client.")),
    title,
    description: optionalText(4000),
    priority: z.preprocess(blankToNull, z.enum(REQUEST_PRIORITIES).nullable()),
    source: z.preprocess(blankToNull, z.enum(REQUEST_SOURCES).nullable()),
    websiteUrl: optionalText(2048),
    /** included = in monthly care. addon = a quoted add-on. Omit it on the owner form. */
    coverage: z.preprocess(blankToNull, z.enum(REQUEST_COVERAGE).nullable()),
    /** Starting status. Omit it to leave the database default (`new`). */
    status: z.preprocess(blankToNull, z.enum(REQUEST_STATUSES).nullable()),
    /** Optional add-on estimate, in dollars. Not an invoice and not a charge. */
    price,
  })
  .superRefine((v, ctx) => {
    if (v.coverage !== "addon" && v.price !== null && v.price > 0) {
      ctx.addIssue({ code: "custom", path: ["price"], message: "A price is only for an add-on request. Included requests have no price." });
    }
  });
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const requestCommentSchema = z.object({
  requestId: z.string().trim().pipe(z.uuid("That request was not recognised.")),
  body: z.string().trim().min(1, "Write a comment.").max(4000, "Use at most 4000 characters."),
});
export type RequestCommentInput = z.infer<typeof requestCommentSchema>;

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

const patchText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null || v.trim() === "" ? null : v));

/** Changes only the fields that were sent. */
export const updateTaskSchema = z
  .object({
    id: z.string().trim().pipe(z.uuid()),
    title: z.string().trim().min(3, "Give it a title of at least 3 characters.").max(200, "Use at most 200 characters.").optional(),
    description: patchText(4000),
    clientId: z.preprocess(blankToNull, z.uuid("Pick a valid client.").nullable()).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    dueDate: z.preprocess(blankToNull, z.string().refine(isValidIsoDate, "Enter the due date as a real date.").nullable()).optional(),
    status: z.enum(TASK_STATUSES).optional(),
  })
  .refine((v) => v.title !== undefined || v.description !== undefined || v.clientId !== undefined || v.priority !== undefined || v.dueDate !== undefined || v.status !== undefined, {
    message: "Send at least one field to change.",
  });
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
