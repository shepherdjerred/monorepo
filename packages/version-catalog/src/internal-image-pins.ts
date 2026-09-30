import { VersionCatalogSchema } from "./index.ts";

// Internal image values are a release version, CI build number, and digest.
// The repository identity is the catalog entry name, which the full-object
// comparison below requires to remain unchanged.
const PIN_VALUE = /^(\d+\.\d+\.\d+)-\d+@sha256:[a-f0-9]{64}$/u;

/** Prove that every catalog delta is an unmanaged internal image pin. */
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
    const nextPin = PIN_VALUE.exec(entry.value);
    const oldPin = PIN_VALUE.exec(oldEntry.value);
    if (
      entry.category !== "internal-image" ||
      entry.artifactType !== "image" ||
      entry.management.managed
    )
      return entry;
    if (nextPin === null || oldPin === null) return entry;
    return nextPin[1] === oldPin[1]
      ? { ...entry, value: oldEntry.value }
      : entry;
  });
  return (
    JSON.stringify({ ...after.data, entries: normalized }) ===
    JSON.stringify(before.data)
  );
}
