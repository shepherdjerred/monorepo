import { VersionCatalogSchema } from "./index.ts";

const PIN_VALUE = /^.+@sha256:[a-f0-9]{64}$/u;

/** Prove that every catalog delta is an unmanaged internal image digest. */
export function onlyInternalImagePinsChanged(
  beforeRaw: unknown,
  afterRaw: unknown,
): boolean {
  const before = VersionCatalogSchema.safeParse(beforeRaw);
  const after = VersionCatalogSchema.safeParse(afterRaw);
  if (!before.success || !after.success) return false;

  const oldEntries = before.data.entries;
  const newEntries = after.data.entries;
  if (oldEntries.length !== newEntries.length) return false;

  const normalized = newEntries.map((entry, index) => {
    const oldEntry = oldEntries[index];
    if (oldEntry === undefined || entry.value === oldEntry.value) return entry;
    return entry.category !== "internal-image" ||
      entry.artifactType !== "image" ||
      entry.management.managed ||
      !PIN_VALUE.test(entry.value) ||
      !PIN_VALUE.test(oldEntry.value) ||
      entry.value.slice(0, -64) !== oldEntry.value.slice(0, -64)
      ? entry
      : { ...entry, value: oldEntry.value };
  });
  return (
    JSON.stringify({ ...after.data, entries: normalized }) ===
    JSON.stringify(before.data)
  );
}
