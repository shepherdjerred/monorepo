import type { z, ZodError } from "zod";

export type FallbackResult<T> =
  | { ok: true; data: T; unknownKeyPaths: readonly string[] }
  | { ok: false; error: ZodError };

function getProp(node: unknown, key: PropertyKey): unknown {
  if (node === null || typeof node !== "object") return undefined;
  return Reflect.get(node, key);
}

function walkAndDeleteKeys(
  root: unknown,
  path: readonly PropertyKey[],
  keys: readonly string[],
): boolean {
  let node: unknown = root;
  for (const segment of path) {
    node = getProp(node, segment);
    if (node === null || typeof node !== "object") {
      return false;
    }
  }
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    return false;
  }
  const target: object = node;
  let ok = true;
  for (const key of keys) {
    if (!Reflect.deleteProperty(target, key)) ok = false;
  }
  return ok;
}

function dottedPath(path: readonly PropertyKey[], leaf: string): string {
  let head = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      head += `[${segment.toString()}]`;
    } else if (typeof segment === "string") {
      head += head === "" ? segment : `.${segment}`;
    }
  }
  return head === "" ? leaf : `${head}.${leaf}`;
}

/**
 * Parse `payload` against `schema` strictly. If validation fails *only*
 * because of `unrecognized_keys` issues (Riot added new fields), strip
 * those exact keys from a deep clone and re-parse. Returns the dotted
 * paths of the stripped keys so callers can WARN + meter.
 *
 * Any non-`unrecognized_keys` issue (real schema break — type change,
 * missing required field, etc.) short-circuits and returns the original
 * error. This keeps actual breakage loud while tolerating additive drift.
 */
export function parseWithUnknownKeyFallback<T>(
  schema: z.ZodType<T>,
  payload: unknown,
): FallbackResult<T> {
  const first = schema.safeParse(payload);
  if (first.success) {
    return { ok: true, data: first.data, unknownKeyPaths: [] };
  }
  const issues = first.error.issues;
  const allUnknown =
    issues.length > 0 && issues.every((i) => i.code === "unrecognized_keys");
  if (!allUnknown) {
    return { ok: false, error: first.error };
  }
  const clone: unknown = structuredClone(payload);
  const unknownKeyPaths: string[] = [];
  // `allUnknown` above already narrowed every issue's code to
  // "unrecognized_keys", so `issue.keys` is always accessible here.
  for (const issue of issues) {
    const stripped = walkAndDeleteKeys(clone, issue.path, issue.keys);
    if (!stripped) {
      // Defensive: Zod just told us these keys exist at this path; if we
      // can't reach them in the clone something is wrong. Fail closed
      // rather than recover silently.
      return { ok: false, error: first.error };
    }
    for (const key of issue.keys) {
      unknownKeyPaths.push(dottedPath(issue.path, key));
    }
  }
  const second = schema.safeParse(clone);
  if (!second.success) {
    return { ok: false, error: second.error };
  }
  return { ok: true, data: second.data, unknownKeyPaths };
}
