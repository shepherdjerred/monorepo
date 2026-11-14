import type { PromotionBatch, PromotionHistoryEntry } from "./model.ts";

const latest = (values: string[]) =>
  values.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

/** Inventory skips and previews are not executions; report save times are not action times. */
export function promotionHistoryTiming(input: {
  targetId: string;
  batches: PromotionBatch[];
  history: PromotionHistoryEntry[];
}) {
  const runStarts = input.batches.flatMap((batch) =>
    batch.entries.flatMap((entry) =>
      entry.targetId === input.targetId &&
      (entry.effectiveMode ?? batch.mode) === "run" &&
      entry.status !== "queued" &&
      entry.startedAt !== null
        ? [entry.startedAt]
        : [],
    ),
  );
  const attempts = input.history.filter(
    (entry) =>
      entry.targetId === input.targetId &&
      entry.status === "verified" &&
      entry.timeBasis === "attempt",
  );
  const successes = input.history
    .filter(
      (entry) =>
        entry.targetId === input.targetId &&
        entry.status === "verified" &&
        (entry.timeBasis === "attempt" ||
          (entry.mode === "run" &&
            entry.timeBasis === "execution" &&
            !attempts.some(
              (attempt) =>
                entry.occurrenceId !== null &&
                attempt.occurrenceId === entry.occurrenceId,
            ))),
    )
    .map((entry) => entry.finishedAt ?? entry.at);
  return {
    lastRunAt: latest(runStarts),
    lastSuccessAt: latest(successes),
  };
}
