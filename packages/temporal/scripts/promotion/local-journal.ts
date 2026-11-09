import {
  PromotionBatchSchema,
  type PromotionBatch,
} from "@shepherdjerred/ops-model/promotion/model.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";

/** Reporting follows the sequential local executor; effect checkpoints stay authoritative. */
export async function createLocalJournal(
  store: PromotionStore,
  id: string,
  mode: PromotionBatch["mode"],
  input: { targetIds: string[]; scope?: PromotionBatch["scope"] },
) {
  const { targetIds, scope } = input;
  const now = new Date().toISOString();
  const key = `local/batches/${id}.json`;
  let batch: PromotionBatch = {
    version: 1,
    id,
    pid: process.pid,
    mode,
    ...(scope === undefined ? {} : { scope }),
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    entries: targetIds.map((targetId) => ({
      targetId,
      status: "queued",
      phase: "Queued",
      startedAt: null,
      finishedAt: null,
      occurrenceId: null,
      summary: "",
    })),
  };
  let queue = Promise.resolve();
  const save = () => {
    const previous = queue;
    queue = (async () => {
      await previous;
      const old = await store.read(key, PromotionBatchSchema);
      if (!(await store.put(key, batch, old?.etag)))
        throw new Error("Concurrent local journal update");
    })();
    return queue;
  };
  await save();
  return {
    async update(
      targetId: string,
      change: Partial<PromotionBatch["entries"][number]>,
    ) {
      await queue;
      batch = {
        ...batch,
        updatedAt: new Date().toISOString(),
        entries: batch.entries.map((entry) =>
          entry.targetId === targetId ? { ...entry, ...change } : entry,
        ),
      };
      await save();
    },
    async finish() {
      await queue;
      batch = { ...batch, finishedAt: new Date().toISOString() };
      await save();
    },
  };
}
