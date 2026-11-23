// Test-only executable control: preserve the current complete runtime and clone
// boundaries, replacing the two checkpoint tree batches with per-row writes.
export function directHistoryControlSource({
  historySource,
  runtimeSource,
  legacyHistoryUrl,
  dependencyUrl,
}) {
  const historyBatch = "setOwnedEntries(copied.changes);";
  const generationBatch =
    "const generations = this.#generationHistory.snapshotWithEntries(\n      generationChanges,\n      undefined,\n    );";
  if (
    historySource.split(historyBatch).length !== 2 ||
    runtimeSource.split(generationBatch).length !== 2
  )
    throw Error(
      "Exact original per-row checkpoint control boundaries required",
    );
  const legacyHistory = historySource.replace(
    historyBatch,
    "for (const [key, value] of copied.changes) setOwned(key, value);",
  );
  const legacyRuntime = runtimeSource
    .replace(
      generationBatch,
      "for (const [id, generation] of generationChanges) this.#generationHistory.set(id, generation);\n    const generations = this.#generationHistory.snapshot();",
    )
    .replace(
      /from "(\.\/[^\"]+)"/g,
      (_, dependency) =>
        `from ${JSON.stringify(dependency === "./latest-direct-checkpoint-history.mjs" ? legacyHistoryUrl(legacyHistory) : dependencyUrl(dependency))}`,
    );
  return { legacyHistory, legacyRuntime };
}
