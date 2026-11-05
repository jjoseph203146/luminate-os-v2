import { z } from "zod";

// What a browser's PushSubscription.toJSON() gives us, as form fields.
export const deviceSchema = z.object({
  endpoint: z.url().max(2048).refine((u) => u.startsWith("https://"), "Push endpoints must be https."),
  p256dh: z.string().min(20).max(200).regex(/^[A-Za-z0-9_-]+$/, "Invalid key."),
  auth: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/, "Invalid key."),
  label: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : null)),
});

export const deviceIdSchema = z.object({ id: z.uuid() });
