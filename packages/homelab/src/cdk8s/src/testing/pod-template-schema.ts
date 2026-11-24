import { z } from "zod";

/** Parse rendered NetworkPolicy / Deployment label selectors without repeating Zod shapes across tests. */
export const PodSelectorSchema = z
  .object({
    matchLabels: z.record(z.string(), z.string()).optional(),
    matchExpressions: z
      .array(
        z.object({
          key: z.string(),
          operator: z.string(),
          values: z.array(z.string()).optional(),
        }),
      )
      .optional(),
  })
  .loose();

export const NamedManifestSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }).loose(),
  })
  .loose();

/** Locate one rendered manifest by Kubernetes `kind` and `metadata.name`. */
export function findManifestByKindAndName(
  manifests: readonly unknown[],
  kind: string,
  name: string,
): unknown {
  const manifest = manifests.find((candidate) => {
    const parsed = NamedManifestSchema.safeParse(candidate);
    return (
      parsed.success &&
      parsed.data.kind === kind &&
      parsed.data.metadata.name === name
    );
  });
  if (manifest === undefined) throw new Error(`Missing ${kind}/${name}`);
  return manifest;
}

/** Parse rendered Pod labels and containers while callers extend their own spec checks. */
export function podTemplateSchema<Container extends z.ZodType>(
  container: Container,
) {
  return z.object({
    metadata: z.object({ labels: z.record(z.string(), z.string()) }),
    spec: z.object({ containers: z.array(container) }),
  });
}
