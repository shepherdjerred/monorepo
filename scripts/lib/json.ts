/**
 * Dependency-free helpers for narrowing untrusted JSON (registry/API/file
 * bodies) without type-guard functions or assertions. Keeping this boundary
 * on platform primitives lets tiny release steps parse JSON without silently
 * auto-installing the root scripts workspace.
 */

/**
 * Return `value` as a string-keyed record, or null if it is not an object.
 * Use instead of a `value is Record<...>` type guard.
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      return null;
    }
    const propertyValue: unknown = descriptor.value;
    record[key] = propertyValue;
  }
  return record;
}

/**
 * Parse `value` into a `Record<string, string>`, keeping only string-valued
 * entries. Non-object input yields an empty record.
 */
export function toStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (record === null) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}
