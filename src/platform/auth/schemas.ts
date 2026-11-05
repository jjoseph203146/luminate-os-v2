import { z } from "zod";
import { ValidationError } from "@/platform/errors";

export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message)),
    );
  }
  return result.data;
}

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});

export const emailOnlySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

// 72 is bcrypt's limit, which Supabase uses for stored passwords.
export const newPasswordSchema = z
  .object({
    password: z.string().min(12, "Use at least 12 characters.").max(72, "Use at most 72 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "The two passwords do not match.", path: ["confirm"] });

export const mfaCodeSchema = z.object({
  code: z
    .string()
    .transform((s) => s.replace(/\s+/g, ""))
    .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code.")),
});
