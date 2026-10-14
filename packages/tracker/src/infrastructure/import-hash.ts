import type { ImportRecord } from "#shared/import-schema.ts";

export function importContentHash(record: ImportRecord) {
  const { actor: _actor, ...source } = record;
  const value =
    record.entityType === "attachment"
      ? { ...source, data: { ...record.data, contentBase64: undefined } }
      : source;
  const canonical = JSON.stringify(value, (_key, item: unknown) =>
    item === null || typeof item !== "object" || Array.isArray(item)
      ? item
      : Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        ),
  );
  return new Bun.CryptoHasher("sha256").update(canonical).digest("hex");
}
