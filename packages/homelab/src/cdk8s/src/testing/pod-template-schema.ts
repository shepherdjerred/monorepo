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

/** Parse rendered Pod labels and containers while callers extend their own spec checks. */
export function podTemplateSchema<Container extends z.ZodType>(
  container: Container,
) {
  return z.object({
    metadata: z.object({ labels: z.record(z.string(), z.string()) }),
    spec: z.object({ containers: z.array(container) }),
  });
}
