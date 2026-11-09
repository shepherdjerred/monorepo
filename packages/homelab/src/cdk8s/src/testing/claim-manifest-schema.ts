import { z } from "zod";

/** A rendered PersistentVolumeClaim's identity, health annotations and sizing. */
export const ClaimManifestSchema = z.looseObject({
  kind: z.literal("PersistentVolumeClaim"),
  metadata: z.looseObject({
    name: z.string(),
    namespace: z.string(),
    labels: z.record(z.string(), z.string()).optional(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.looseObject({
    accessModes: z.array(z.string()),
    storageClassName: z.string(),
    resources: z.object({ requests: z.object({ storage: z.string() }) }),
  }),
});
export type ClaimManifest = z.infer<typeof ClaimManifestSchema>;

/** The claims among a chart's rendered manifests, in render order; a malformed claim throws. */
export function renderedClaims(manifests: unknown[]): ClaimManifest[] {
  return z
    .array(z.looseObject({ kind: z.string() }))
    .parse(manifests)
    .filter((manifest) => manifest.kind === "PersistentVolumeClaim")
    .map((manifest) => ClaimManifestSchema.parse(manifest));
}
