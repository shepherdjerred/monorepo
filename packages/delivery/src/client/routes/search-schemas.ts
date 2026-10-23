import { z } from "zod";
import { DeploymentStatusSchema } from "#shared/contract.ts";
import { PipelineStatusSchema } from "#shared/hub/hub-contract.ts";

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

export const PipelineSearchSchema = z.object({
  q: lenient(Optional),
  status: lenient(PipelineStatusSchema),
});
export type PipelineSearch = z.infer<typeof PipelineSearchSchema>;

export const CursorSearchSchema = z.object({ cursor: lenient(Optional) });

export const DeploymentSearchSchema = z.object({
  cursor: lenient(Optional),
  service: lenient(Optional),
  environment: lenient(Optional),
  status: lenient(DeploymentStatusSchema),
});

export const ArtifactSearchSchema = z.object({
  cursor: lenient(Optional),
  service: lenient(Optional),
  status: lenient(z.enum(["pending", "verified", "failed"])),
});

export const ActivitySearchSchema = z.object({
  cursor: lenient(Optional),
  actor: lenient(Optional),
  action: lenient(Optional),
  entity: lenient(Optional),
});

export const EnvironmentSearchSchema = z.object({
  release: lenient(z.enum(["deploy", "promote"])),
  version: lenient(Optional),
});

export const VersionSearchSchema = z.object({ compare: lenient(Optional) });

/** Keep only filter fields a form submitted with a value. */
export function formSearch(form: HTMLFormElement) {
  const values: Record<string, string> = {};
  for (const [key, value] of new FormData(form))
    if (typeof value === "string" && value.trim() !== "")
      values[key] = value.trim();
  return values;
}
