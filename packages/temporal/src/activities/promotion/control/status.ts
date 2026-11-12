import { createHash } from "node:crypto";
import {
  PromotionBatchSchema,
  PromotionOverviewSchema,
  type PromotionHistoryEntry,
  type PromotionOverview,
} from "@shepherdjerred/ops-model/promotion/model.ts";
import { promotionRunSummary } from "@shepherdjerred/ops-model/promotion/summary.ts";
import {
  PromotionStateSchema,
  initialPromotionState,
  promotionDispatchAt,
  promotionFailurePause,
} from "#shared/promotion/model.ts";
import { promotionManifest } from "#activities/promotion/manifest.ts";
import { PromotionBatchIndex } from "./batches.ts";
import {
  promotionStore,
  type PromotionStore,
} from "#activities/promotion/store.ts";
import { promotionSpendDay, dailyPromotionSolverCharges } from "./budget.ts";
import { z } from "zod/v4";
import {
  PromotionAiLedgerSchema,
  promotionAiAccounting,
} from "@shepherdjerred/ops-model/promotion/ai-allocation.ts";

type Batch = z.infer<typeof PromotionBatchSchema>;
function entryStatus(batch: Batch, entry: Batch["entries"][number]) {
  if (
    batch.interrupted === true &&
    (entry.status === "running" || entry.status === "queued")
  )
    return "interrupted";
  return entry.status === "completed" ? entry.phase : entry.status;
}
const stores = new WeakMap<PromotionStore, Map<string, Batch>>();
const Cleanup = z.object({
  status: z.string(),
  summary: z.string().optional(),
});

async function readCleanups(store: PromotionStore, batches: Batch[]) {
  const ids = new Set(
    batches.flatMap((batch) =>
      batch.entries.flatMap((entry) =>
        entry.targetId === "disboard-native-bump" && entry.occurrenceId !== null
          ? [entry.occurrenceId]
          : [],
      ),
    ),
  );
  return new Map(
    await Promise.all(
      [...ids].map(
        async (id) =>
          [
            id,
            await store.read(`cleanup/${encodeURIComponent(id)}.json`, Cleanup),
          ] as const,
      ),
    ),
  );
}

function readStates(store: PromotionStore) {
  return Promise.all(
    promotionManifest.targets.map(async (target) => {
      const row = await store.read(
        `targets/${target.id}.json`,
        PromotionStateSchema,
      );
      return row?.value ?? initialPromotionState(target.id, 900);
    }),
  );
}

async function readBatches(store: PromotionStore) {
  const settled = stores.get(store) ?? new Map<string, Batch>();
  stores.set(store, settled);
  const index = await store.read("batches/index.json", PromotionBatchIndex);
  for (const id of settled.keys()) {
    if (index?.value.includes(id) !== true) settled.delete(id);
  }
  const batches = await Promise.all(
    (index?.value ?? []).map(async (id) => {
      const cached = settled.get(id);
      if (cached !== undefined) return cached;
      const row = await store.read(
        `batches/${encodeURIComponent(id)}.json`,
        PromotionBatchSchema,
      );
      if (row === undefined)
        throw new Error("Indexed promotion batch is missing");
      if (row.value.finishedAt !== null) settled.set(id, row.value);
      return row.value;
    }),
  );
  return batches;
}

export async function readProductionPromotionStatus(
  store: PromotionStore = promotionStore(),
) {
  const states = await readStates(store);
  const batches = await readBatches(store);
  const cleanups = await readCleanups(store, batches);
  const evidence = new Map<string, string>();
  const evidenceId = (key: string | null) => {
    if (key === null) return null;
    const id = createHash("sha256").update(key).digest("hex");
    evidence.set(id, key);
    return id;
  };
  const history: PromotionHistoryEntry[] = [];
  for (const state of states)
    for (const attempt of state.attempts)
      history.push({
        id: `attempt:${attempt.occurrenceId}`,
        batchId: null,
        targetId: state.targetId,
        mode: "unknown",
        status: attempt.status,
        summary: "Recorded publishing attempt",
        at: attempt.attemptedAt,
        timeBasis: "attempt",
        finishedAt: attempt.settledAt,
        occurrenceId: attempt.occurrenceId,
        receiptUrl: attempt.receiptUrl,
        evidenceId: evidenceId(attempt.evidenceKey),
        costUsd: null,
        cleanup: null,
      });
  for (const batch of batches)
    for (const entry of batch.entries) {
      const state = states.find((s) => s.targetId === entry.targetId);
      const attempt = state?.attempts.find(
        (a) => a.occurrenceId === entry.occurrenceId,
      );
      const cleanup =
        entry.occurrenceId === null
          ? undefined
          : cleanups.get(entry.occurrenceId);
      history.push({
        id: `batch:${batch.id}:${entry.targetId}`,
        batchId: batch.id,
        targetId: entry.targetId,
        mode: entry.effectiveMode ?? batch.mode,
        status: entryStatus(batch, entry),
        summary: entry.summary,
        at: entry.startedAt ?? batch.startedAt,
        timeBasis: "execution",
        finishedAt: entry.finishedAt,
        occurrenceId: entry.occurrenceId,
        receiptUrl: attempt?.receiptUrl ?? null,
        evidenceId: evidenceId(attempt?.evidenceKey ?? null),
        costUsd: null,
        cleanup:
          cleanup === undefined
            ? null
            : `${cleanup.value.status}: ${cleanup.value.summary ?? ""}`,
      });
    }
  history.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const sources: PromotionOverview["sources"] = promotionManifest.targets.map(
    (target, i) => {
      const state = states[i];
      if (state === undefined) throw new Error("Missing source state");
      const entries = history.filter((h) => h.targetId === target.id);
      const due = promotionDispatchAt(target, state);
      return {
        id: target.id,
        name: target.name,
        url: target.url,
        action: target.action,
        notes: target.notes,
        platform:
          target.discord === undefined
            ? target.account === "reddit"
              ? "Reddit"
              : target.id === "pmc"
                ? "PMC"
                : "Server list"
            : "Discord",
        constraint: state.attempts.some((a) => a.status === "uncertain")
          ? "Needs reconciliation"
          : state.paused
            ? "Paused"
            : (promotionFailurePause(state) ?? state.blockedReason ?? ""),
        nextAllowedAt: due === 0 ? null : new Date(due).toISOString(),
        latest: entries.find((h) => h.timeBasis === "execution") ?? null,
        preview: entries.find((h) => h.mode === "preview") ?? null,
        lastAction:
          entries.find(
            (h) => h.timeBasis === "attempt" && h.status === "verified",
          ) ?? null,
      };
    },
  );
  const spend = await readPromotionSpend(store);
  const presentation = batches.map((batch) => ({
    ...batch,
    interrupted: batch.interrupted ?? false,
  }));
  const overview = PromotionOverviewSchema.parse({
    version: 1,
    readAt: new Date().toISOString(),
    scheduling: "scheduled",
    sources,
    batches: presentation,
    lastRun: promotionRunSummary({ sources, batches: presentation, history }),
    spend,
  });
  return { overview, history, evidence };
}

export async function readPromotionSpend(
  store: PromotionStore = promotionStore(),
) {
  const day = promotionSpendDay();
  const ledger = await store.read(
    `ai/daily/${day}.json`,
    PromotionAiLedgerSchema,
  );
  const charges = Object.values(ledger?.value ?? {});
  const solverCharges = await dailyPromotionSolverCharges(store);
  return {
    day,
    ...promotionAiAccounting(charges),
    captchaUsd:
      solverCharges.reduce((n, c) => n + (c.chargedMicrousd ?? 0), 0) / 1e6,
    pendingCaptchaUsd:
      solverCharges
        .filter((c) => c.chargedMicrousd === null)
        .reduce((n, c) => n + c.reservedMicrousd, 0) / 1e6,
  };
}
