import { z } from "zod/v4";

export function stripClaudeSchemaAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripClaudeSchemaAnnotations(entry));
  }
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  if (!record.success) return value;

  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record.data)) {
    if (
      (key === "$schema" && typeof entry === "string") ||
      (key === "format" && typeof entry === "string")
    ) {
      continue;
    }
    normalized[key] = stripClaudeSchemaAnnotations(entry);
  }
  return normalized;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (typeof value !== "object" || value === null) return value;

  const sorted: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value).toSorted(([a], [b]) =>
    a.localeCompare(b),
  )) {
    sorted[key] = sortJson(entryValue);
  }
  return sorted;
}

export function jsonSchemaFingerprint(schema: unknown): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify(sortJson(schema)));
  return hasher.digest("hex").slice(0, 16);
}
