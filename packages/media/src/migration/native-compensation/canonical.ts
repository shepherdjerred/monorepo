import { MediaError } from "#application/errors.ts";

function changedCoverage() {
  return new MediaError(
    "compensation_canonical_scope_changed",
    "Interrupted publication coverage changed",
    409,
  );
}

/** Match the approved physical projection without changing original FilePlan order. */
export function canonicalCompensationEntries<
  File extends { assetId: string; mediaIds: readonly string[] },
  Entry extends {
    predecessor: { id: string } | null;
    entry: { mediaIds: readonly string[] };
  },
>(files: readonly File[], entries: readonly Entry[]) {
  if (
    files.length !== entries.length ||
    new Set(files.map((file) => file.assetId)).size !== files.length
  )
    throw changedCoverage();
  return files.map((file) => {
    const matches = entries.filter(
      (entry) => entry.predecessor?.id === file.assetId,
    );
    const entry = matches[0];
    if (
      entry === undefined ||
      matches.length !== 1 ||
      new Set(file.mediaIds).size !== file.mediaIds.length ||
      new Set(entry.entry.mediaIds).size !== entry.entry.mediaIds.length ||
      JSON.stringify(file.mediaIds.toSorted()) !==
        JSON.stringify(entry.entry.mediaIds.toSorted())
    )
      throw changedCoverage();
    return { file, entry };
  });
}
