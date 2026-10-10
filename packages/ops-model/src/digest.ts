import { z } from "zod";

export const DigestKindSchema = z.enum(["daily", "weekly"]);
export type DigestKind = z.infer<typeof DigestKindSchema>;

/** Durable dashboard outcome; HTTP success alone does not prove a send. */
export const DigestRunResponseSchema = z.object({
  kind: DigestKindSchema,
  periodKey: z.string().min(1),
  status: z.enum(["sent", "skipped"]),
  duplicate: z.boolean(),
});
export type DigestRunResponse = z.infer<typeof DigestRunResponseSchema>;
