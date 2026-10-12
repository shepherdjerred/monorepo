import { z } from "zod";

function removeUnrecognized(
  candidate: unknown,
  issue: z.core.$ZodIssueUnrecognizedKeys,
): void {
  let node: unknown = candidate;
  for (const key of issue.path)
    node =
      node !== null && typeof node === "object"
        ? Reflect.get(node, key)
        : undefined;
  if (node === null || typeof node !== "object")
    throw new TypeError("Invalid raw JSON validation path");
  for (const key of issue.keys) Reflect.deleteProperty(node, key);
}

/** Restore the capture onto a validated object without bypassing its type contract. */
function restoreCapture<T>(parsed: T, raw: unknown): T {
  if (parsed === null || typeof parsed !== "object")
    throw new TypeError("Raw Riot documents must be objects");
  const serialized = JSON.stringify(raw);
  const capture = z.record(z.string(), z.json()).parse(JSON.parse(serialized));
  for (const key of Object.keys(parsed)) Reflect.deleteProperty(parsed, key);
  for (const [key, value] of Object.entries(structuredClone(capture))) {
    Object.defineProperty(parsed, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return parsed;
}

/** Validate known fields while retaining every captured field, array and null.
 * Only raw Riot documents use this contract; application protocols stay strict.
 */
export function preserveRawJson<T>(schema: z.ZodType<T>): z.ZodType<T> {
  return z.unknown().transform((raw, ctx) => {
    const candidate: unknown = structuredClone(raw);
    const first = schema.safeParse(candidate);
    if (first.success) return restoreCapture(first.data, raw);
    for (const issue of first.error.issues) {
      if (issue.code === "unrecognized_keys")
        removeUnrecognized(candidate, issue);
      else
        ctx.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
    }
    if (ctx.issues.length > 0) return z.NEVER;
    const checked = schema.safeParse(candidate);
    if (checked.success) return restoreCapture(checked.data, raw);
    for (const issue of checked.error.issues)
      ctx.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    return z.NEVER;
  });
}
