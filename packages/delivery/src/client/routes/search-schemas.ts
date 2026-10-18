import { z } from "zod";
import { DeploymentStatusSchema } from "#shared/contract.ts";

const Optional = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .optional();

/** Search params come from hand-edited URLs, so invalid values are dropped. */
function lenient<T extends z.ZodType>(schema: T) {
  return z
    .unknown()
    .transform((value): z.infer<T> | undefined => schema.safeParse(value).data)
    .optional();
}

export const CursorSearchSchema = z.object({ cursor: lenient(Optional) });

export const DeploymentSearchSchema = z.object({
  cursor: lenient(Optional),
  service: lenient(Optional),
  environment: lenient(Optional),
  status: lenient(DeploymentStatusSchema),
});
export type DeploymentSearch = z.infer<typeof DeploymentSearchSchema>;

export const ArtifactSearchSchema = z.object({
  cursor: lenient(Optional),
  service: lenient(Optional),
  status: lenient(z.enum(["pending", "verified", "failed"])),
});
export type ArtifactSearch = z.infer<typeof ArtifactSearchSchema>;

export const ActivitySearchSchema = z.object({
  cursor: lenient(Optional),
  actor: lenient(Optional),
  action: lenient(Optional),
  entity: lenient(Optional),
});
export type ActivitySearch = z.infer<typeof ActivitySearchSchema>;

export const EnvironmentSearchSchema = z.object({
  release: lenient(z.enum(["deploy", "promote", "rollback"])),
  version: lenient(Optional),
});
export type EnvironmentSearch = z.infer<typeof EnvironmentSearchSchema>;

export const VersionSearchSchema = z.object({ compare: lenient(Optional) });

/** Keep only filter fields a form submitted with a value. */
export function formSearch(form: HTMLFormElement) {
  const values: Record<string, string> = {};
  for (const [key, value] of new FormData(form))
    if (typeof value === "string" && value.trim() !== "")
      values[key] = value.trim();
  return values;
}
