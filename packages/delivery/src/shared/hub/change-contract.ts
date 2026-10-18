import { z } from "zod";

/** Audit action prefixes; every audited write names exactly one domain. */
export const ChangeDomainSchema = z.enum([
  "artifact",
  "build",
  "content",
  "control_plane",
  "deployment",
  "environment",
  "forum",
  "minecraft",
  "pipeline",
  "platform",
  "snapshot",
  "trmnl",
  "versionSet",
  "worker",
]);
export type ChangeDomain = z.infer<typeof ChangeDomainSchema>;
export type AuditAction = `${ChangeDomain}.${string}`;

export const ChangeEventSchema = z.object({
  id: z.string().min(1),
  domain: ChangeDomainSchema,
  action: z.string().min(1),
  entityId: z.string(),
});
export type ChangeEvent = z.infer<typeof ChangeEventSchema>;

export function changeDomain(action: string): ChangeDomain {
  return ChangeDomainSchema.parse(action.split(".", 1)[0]);
}
