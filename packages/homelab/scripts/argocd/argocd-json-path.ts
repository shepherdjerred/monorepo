import { z } from "zod";

/** A decoded JSON object: Kubernetes live and target state as ArgoCD reports them. */
export const JsonObjectSchema = z.record(z.string(), z.unknown());

/** The value at `path` inside nested objects, or undefined where any segment is absent. */
export function valueAt(
  object: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let current: unknown = object;
  for (const segment of path) {
    const parsed = JsonObjectSchema.safeParse(current);
    if (!parsed.success) {
      return undefined;
    }
    current = parsed.data[segment];
  }
  return current;
}
