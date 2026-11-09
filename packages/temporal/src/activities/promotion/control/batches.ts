import { z } from "zod/v4";
import {
  PromotionBatchSchema,
  type PromotionBatch,
} from "@shepherdjerred/ops-model/promotion/model.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";
import type { PromotionTarget, PromotionState } from "#shared/promotion.ts";
import {
  promotionFailurePause,
  promotionDispatchAt,
} from "#shared/promotion.ts";

export const PromotionBatchIndex = z.array(z.string()).max(120);
const key = (id: string) => `batches/${encodeURIComponent(id)}.json`;

async function changeBatch(
  store: PromotionStore,
  id: string,
  change: (batch: PromotionBatch) => PromotionBatch,
) {
  for (let retry = 0; retry < 5; retry++) {
    const old = await store.read(key(id), PromotionBatchSchema);
    if (old === undefined) throw new Error("Promotion batch disappeared");
    if (
      await store.put(
        key(id),
        PromotionBatchSchema.parse(change(old.value)),
        old.etag,
      )
    )
      return;
  }
  throw new Error("Concurrent promotion batch update did not settle");
}

export async function beginPromotionBatch(input: {
  store: PromotionStore;
  id: string;
  targets: PromotionTarget[];
  states: PromotionState[];
  selected: string[];
  mode?: PromotionBatch["mode"];
  scope?: PromotionBatch["scope"];
}) {
  const { store, id } = input;
  const now = new Date().toISOString();
  const batch: PromotionBatch = {
    version: 1,
    id,
    pid: 0,
    mode: input.mode ?? "run",
    scope: input.scope ?? "all",
    startedAt: now,
    updatedAt: now,
    finishedAt: input.selected.length === 0 ? now : null,
    entries: input.targets.map((target) => {
      const state = input.states.find((s) => s.targetId === target.id);
      if (state === undefined)
        throw new Error("Missing source state for batch");
      const selected = input.selected.includes(target.id);
      const reason = skipReason(target, state);
      return {
        targetId: target.id,
        effectiveMode: "run",
        status: selected ? "queued" : "skipped",
        phase: selected ? "Queued" : reason.phase,
        startedAt: null,
        finishedAt: selected ? null : now,
        occurrenceId: null,
        summary: selected ? "" : reason.summary,
      };
    }),
  };
  const existing = await store.read(key(id), PromotionBatchSchema);
  if (existing === undefined && !(await store.put(key(id), batch, undefined)))
    throw new Error("Concurrent batch creation");
  for (let retry = 0; retry < 5; retry++) {
    const index = await store.read("batches/index.json", PromotionBatchIndex);
    const ids = [
      id,
      ...(index?.value ?? []).filter((previous) => previous !== id),
    ].slice(0, 120);
    if (await store.put("batches/index.json", ids, index?.etag)) return;
  }
  throw new Error("Concurrent batch index update did not settle");
}

function skipReason(target: PromotionTarget, state: PromotionState) {
  if (["pending", "inspect"].includes(target.action))
    return { phase: "setup", summary: target.notes };
  if (state.paused) return { phase: "paused", summary: "Source is paused" };
  const paused = promotionFailurePause(state);
  if (paused !== null) return { phase: "paused", summary: paused };
  if (state.attempts.some((a) => a.status === "uncertain"))
    return {
      phase: "uncertain",
      summary:
        "Previous action could not be confirmed; duplicate prevention is active",
    };
  if (promotionDispatchAt(target, state) > Date.now())
    return {
      phase: "cooldown",
      summary: `Cooldown until ${new Date(promotionDispatchAt(target, state)).toISOString()}`,
    };
  return {
    phase: "not-selected",
    summary:
      "Outside this run's source allowlist or preferred publishing window",
  };
}

export async function updatePromotionBatch(input: {
  store: PromotionStore;
  id: string;
  targetId: string;
  change: Partial<PromotionBatch["entries"][number]>;
}) {
  await changeBatch(input.store, input.id, (batch) => ({
    ...batch,
    updatedAt: new Date().toISOString(),
    entries: batch.entries.map((entry) =>
      entry.targetId === input.targetId ? { ...entry, ...input.change } : entry,
    ),
  }));
}

export async function finishPromotionBatch(input: {
  store: PromotionStore;
  id: string;
  overlaps: string[];
}) {
  await changeBatch(input.store, input.id, (batch) => ({
    ...batch,
    updatedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    entries: batch.entries.map((entry) => {
      if (entry.status !== "queued" && entry.status !== "running") return entry;
      const overlap = input.overlaps.includes(entry.targetId);
      return {
        ...entry,
        status: overlap ? "skipped" : "failed",
        phase: overlap ? "owner" : "interrupted",
        finishedAt: new Date().toISOString(),
        summary: overlap
          ? "Another execution already owns this source"
          : "Executor ended without a terminal report; inspect its durable effect history",
      };
    }),
  }));
}
