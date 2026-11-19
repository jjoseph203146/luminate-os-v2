// Envelope for POST /api/bot/writes. Each operation's input is checked by the domain schema, not here.
import { z } from "zod";
import { BOT_OPS } from "./rules";

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/;

export const MAX_OPERATIONS = 25;

export const batchSchema = z.object({
  operations: z
    .array(
      z.object({
        idempotencyKey: z
          .string()
          .trim()
          .min(8, "Use an idempotency key of at least 8 characters.")
          .max(80, "Use an idempotency key of at most 80 characters.")
          .regex(IDEMPOTENCY_KEY, "An idempotency key can use letters, digits and : . _ / -."),
        op: z.enum(BOT_OPS),
        input: z.unknown(),
      }),
    )
    .min(1, "Send at least one operation.")
    .max(MAX_OPERATIONS, `Send at most ${MAX_OPERATIONS} operations.`),
});

export type BatchInput = z.infer<typeof batchSchema>;
