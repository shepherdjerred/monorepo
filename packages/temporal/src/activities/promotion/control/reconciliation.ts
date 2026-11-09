import { z } from "zod/v4";
import type { PromotionState } from "#shared/promotion.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";

const Probe = z.object({
  attempts: z.number().int().min(0).max(2),
  lastBatchId: z.string().nullable(),
});
const key = (occurrence: string) =>
  `reconciliation/${encodeURIComponent(occurrence)}.json`;

/** Two read-only follow-ups, never an automatic resend of an uncertain effect. */
export async function reserveReconciliation(
  store: PromotionStore,
  state: PromotionState,
  batchId: string,
) {
  const pending = state.attempts.filter((a) => a.status === "uncertain");
  if (pending.length !== 1 || state.paused) return false;
  const original = pending[0];
  if (original === undefined) throw new Error("Uncertain attempt disappeared");
  for (let retry = 0; retry < 5; retry++) {
    const old = await store.read(key(original.occurrenceId), Probe);
    if (old?.value.lastBatchId === batchId) return true;
    const attempts = old?.value.attempts ?? 0;
    if (attempts >= 2) return false;
    if (
      await store.put(
        key(original.occurrenceId),
        { attempts: attempts + 1, lastBatchId: batchId },
        old?.etag,
      )
    )
      return true;
  }
  throw new Error("Concurrent reconciliation reservation did not settle");
}

export async function resetReconciliation(
  store: PromotionStore,
  state: PromotionState,
) {
  for (const attempt of state.attempts.filter(
    (a) => a.status === "uncertain",
  )) {
    const old = await store.read(key(attempt.occurrenceId), Probe);
    if (
      old !== undefined &&
      !(await store.put(
        key(attempt.occurrenceId),
        { attempts: 0, lastBatchId: null },
        old.etag,
      ))
    )
      throw new Error("Concurrent reconciliation reset");
  }
}
