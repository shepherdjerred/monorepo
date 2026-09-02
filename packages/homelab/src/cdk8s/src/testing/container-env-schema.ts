import { z } from "zod";

/**
 * The recurring shape tests parse out of a synthesized Deployment's
 * `spec.template.spec.containers[].env` to assert on rendered environment
 * variables. Shared so each test file composing a Deployment schema doesn't
 * re-declare the identical nested Zod object (jscpd flags that duplication).
 */
export const ContainerEnvSchema = z.array(
  z.object({
    name: z.string(),
    value: z.string().optional(),
    valueFrom: z
      .object({
        secretKeyRef: z.object({ key: z.string(), name: z.string() }),
      })
      .optional(),
  }),
);
