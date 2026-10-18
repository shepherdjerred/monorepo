import { z } from "zod";

/** Parse rendered Pod labels and containers while callers extend their own spec checks. */
export function podTemplateSchema<Container extends z.ZodType>(
  container: Container,
) {
  return z.object({
    metadata: z.object({ labels: z.record(z.string(), z.string()) }),
    spec: z.object({ containers: z.array(container) }),
  });
}
