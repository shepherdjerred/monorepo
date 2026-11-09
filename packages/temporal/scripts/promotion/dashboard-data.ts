import type { PromotionBatch } from "@shepherdjerred/ops-model/promotion/model.ts";
import type { PromotionTarget, PromotionState } from "#shared/promotion.ts";
import { Database } from "bun:sqlite";

import { createHash } from "node:crypto";
import { readdir, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  PromotionBatchSchema,
  PromotionOverviewSchema,
  type PromotionHistoryEntry,
} from "@shepherdjerred/ops-model/promotion/model.ts";
import { promotionManifest } from "#activities/promotion/manifest.ts";
import {
  PromotionStateSchema,
  promotionDispatchAt,
  promotionFailurePause,
} from "#shared/promotion.ts";
import { SolverBudgetSchema } from "#activities/promotion/store.ts";
import { promotionSpendDay } from "#activities/promotion/control/budget.ts";
import { promotionRunSummary } from "@shepherdjerred/ops-model/promotion/summary.ts";
import { localOwnerAlive } from "./process-owner.ts";

const Row = z.object({ key: z.string(), value: z.string() });
const Result = z.object({
  status: z.string(),
  summary: z.string(),
  receipt: z.object({ url: z.string() }).nullable().optional(),
});
const Report = z.array(
  z.object({
    targetId: z.string(),
    result: Result.optional(),
    status: z.string().optional(),
    summary: z.string().optional(),
    aiCostUsd: z.number().optional(),
    cleanup: z
      .object({ status: z.string(), summary: z.string().optional() })
      .optional(),
  }),
);
const Ledger = z.record(
  z.string(),
  z.object({ chargedUsd: z.number().nullable() }),
);
export function ownerAbsent(pid: number, startedAt?: string) {
  return !localOwnerAlive(pid, startedAt);
}
export async function readDashboard(directory: string) {
  const db = new Database(path.join(directory, "promotion.sqlite"), {
    readonly: true,
  });
  let objects: Map<string, unknown>;
  try {
    objects = new Map(
      z
        .array(Row)
        .parse(
          db
            .query(
              "SELECT key, value FROM objects WHERE key LIKE 'targets/%' OR key LIKE 'local/batches/%' OR key LIKE 'ai/daily/%' OR key LIKE 'solver/%'",
            )
            .all(),
        )
        .map((row) => [row.key, JSON.parse(row.value) as unknown]),
    );
  } finally {
    db.close();
  }
  const batches = [...objects.entries()]
    .filter(([key]) => key.startsWith("local/batches/"))
    .map(([, value]) => PromotionBatchSchema.parse(value))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const history: PromotionHistoryEntry[] = [];
  const evidence = new Map<string, string>();
  const artifact = (file: string | null) => {
    if (file === null) return null;
    const id = createHash("sha256").update(file).digest("hex");
    evidence.set(id, file);
    return id;
  };
  const states = new Map(
    promotionManifest.targets.flatMap((target) => {
      const value = objects.get(`targets/${target.id}.json`);
      return value === undefined
        ? []
        : [[target.id, PromotionStateSchema.parse(value)] as const];
    }),
  );
  for (const [targetId, state] of states)
    for (const attempt of state.attempts) {
      history.push({
        id: `attempt:${attempt.occurrenceId}`,
        batchId: null,
        targetId,
        mode: "unknown",
        status: attempt.status,
        summary: "Recorded publishing attempt",
        at: attempt.attemptedAt,
        timeBasis: "attempt",
        finishedAt: attempt.settledAt,
        occurrenceId: attempt.occurrenceId,
        receiptUrl: attempt.receiptUrl,
        evidenceId: artifact(attempt.evidenceKey),
        costUsd: null,
        cleanup: null,
      });
    }
  await loadReports(directory, batches, history);
  for (const batch of batches)
    for (const entry of batch.entries) {
      if (
        history.some(
          (item) =>
            item.batchId === batch.id && item.targetId === entry.targetId,
        )
      )
        continue;
      history.push({
        id: `execution:${batch.id}:${entry.targetId}`,
        batchId: batch.id,
        targetId: entry.targetId,
        mode: entry.effectiveMode ?? batch.mode,
        status:
          batch.finishedAt === null && ownerAbsent(batch.pid, batch.startedAt)
            ? "interrupted"
            : entry.status,
        summary: entry.summary || entry.phase,
        at: entry.startedAt ?? batch.startedAt,
        timeBasis: "execution",
        finishedAt: entry.finishedAt,
        occurrenceId: entry.occurrenceId,
        receiptUrl: null,
        evidenceId: null,
        costUsd: null,
        cleanup: null,
      });
    }
  history.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const spend = readSpend(objects);
  const presentationBatches = batches.map((batch) => ({
    ...batch,
    interrupted:
      batch.finishedAt === null && ownerAbsent(batch.pid, batch.startedAt),
  }));
  const sources = promotionManifest.targets.map((target) =>
    sourceView(target, states.get(target.id), history),
  );
  const overview = PromotionOverviewSchema.parse({
    version: 1,
    readAt: new Date().toISOString(),
    scheduling: "manual",
    batches: presentationBatches,
    lastRun: promotionRunSummary({
      sources,
      batches: presentationBatches,
      history,
    }),
    spend,
    sources,
  });
  return { overview, history, evidence };
}

export async function receiptFile(directory: string, file: string) {
  const root = await realpath(directory),
    actual = await realpath(file);
  if (
    !actual.startsWith(`${root}${path.sep}`) ||
    ![".png", ".json"].includes(path.extname(actual))
  )
    throw new Error("Evidence outside receipt directory");
  return actual;
}

function runDirectories(directory: string) {
  return readdir(path.join(directory, "runs"), { withFileTypes: true });
}

async function loadReports(
  directory: string,
  batches: PromotionBatch[],
  history: PromotionHistoryEntry[],
) {
  let directories: Awaited<ReturnType<typeof runDirectories>>;
  try {
    directories = await runDirectories(directory);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    directories = [];
  }
  const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
  for (const entry of directories) {
    if (!entry.isDirectory()) continue;
    const file = path.join(directory, "runs", entry.name, "summary.json");
    if (!(await Bun.file(file).exists())) continue;
    const metadata = await stat(file);
    const savedAt = metadata.mtime.toISOString();
    const report = Report.parse(await Bun.file(file).json());
    const batch = batchMap.get(entry.name);
    for (const [index, row] of report.entries()) {
      const execution = batch?.entries.find(
        (item) => item.targetId === row.targetId,
      );
      // Publishing attempts are rendered once; executions provide their original explanations.
      history.push(
        reportEntry({
          batchId: entry.name,
          index,
          row,
          batch,
          execution,
          savedAt,
        }),
      );
    }
  }
}

function readSpend(objects: Map<string, unknown>) {
  const day = promotionSpendDay();
  const ledger = Ledger.parse(objects.get(`ai/daily/${day}.json`) ?? {});
  let captchaUsd = 0,
    pendingCaptchaUsd = 0;
  for (const [key, value] of objects)
    if (key.startsWith("solver/"))
      for (const charge of Object.values(
        SolverBudgetSchema.parse(value).charges,
      )) {
        if (
          charge.createdAt === undefined ||
          promotionSpendDay(new Date(charge.createdAt)) !== day
        )
          continue;
        if (charge.chargedMicrousd === null)
          pendingCaptchaUsd += charge.reservedMicrousd / 1e6;
        else captchaUsd += charge.chargedMicrousd / 1e6;
      }
  return {
    day,
    aiUsd: Object.values(ledger).reduce(
      (sum, row) => sum + (row.chargedUsd ?? 0),
      0,
    ),
    unknownAi: Object.values(ledger).filter((row) => row.chargedUsd === null)
      .length,
    captchaUsd,
    pendingCaptchaUsd,
  };
}

function sourceView(
  target: PromotionTarget,
  state: PromotionState | undefined,
  history: PromotionHistoryEntry[],
) {
  const entries = history.filter((item) => item.targetId === target.id);
  const latest = entries.find((item) => item.timeBasis !== "attempt") ?? null;
  const deadline = state === undefined ? 0 : promotionDispatchAt(target, state);
  return {
    id: target.id,
    name: target.name,
    platform:
      target.discord !== undefined ||
      new URL(target.url).hostname === "discord.com"
        ? "Discord"
        : target.account === "reddit"
          ? "Reddit"
          : target.id === "pmc"
            ? "PMC"
            : /forum|builtbybit/.test(target.id)
              ? "Forum"
              : "Server list",
    url: target.url,
    action: target.action,
    notes: target.notes,
    constraint: constraint(target, state),
    nextAllowedAt: deadline === 0 ? null : new Date(deadline).toISOString(),
    latest,
    preview: entries.find((item) => item.mode === "preview") ?? null,
    lastAction:
      entries
        .filter(
          (item) => item.timeBasis === "attempt" && item.status === "verified",
        )
        .sort((a, b) => b.at.localeCompare(a.at))[0] ?? null,
  };
}

function constraint(
  target: PromotionTarget,
  state: PromotionState | undefined,
) {
  if (state?.attempts.some((item) => item.status === "uncertain") === true)
    return "Needs reconciliation";
  if (state?.lock != null) return "Outstanding owner";
  if (state?.paused === true) return "Paused";
  const failurePause =
    state === undefined ? null : promotionFailurePause(state);
  if (failurePause !== null) return failurePause;
  return (
    state?.blockedReason ??
    (target.action === "pending" ? "Setup / assignment pending" : "")
  );
}

function reportEntry({
  batchId,
  index,
  row,
  batch,
  execution,
  savedAt,
}: {
  batchId: string;
  index: number;
  row: z.infer<typeof Report>[number];
  batch: PromotionBatch | undefined;
  execution: PromotionBatch["entries"][number] | undefined;
  savedAt: string;
}): PromotionHistoryEntry {
  return {
    id: `report:${batchId}:${String(index)}`,
    batchId: batchId,
    targetId: row.targetId,
    mode:
      execution?.effectiveMode ??
      batch?.mode ??
      (row.result?.status === "preview" ? "preview" : "unknown"),
    status:
      execution?.status === "skipped"
        ? "skipped"
        : (row.result?.status ?? row.status ?? "unknown"),
    ...reportOutcome(row),
    at: execution?.startedAt ?? savedAt,
    timeBasis: execution?.startedAt == null ? "report-saved" : "execution",
    finishedAt: execution?.finishedAt ?? null,
    occurrenceId: execution?.occurrenceId ?? null,
    evidenceId: null,
  };
}

function cleanupText(cleanup: z.infer<typeof Report>[number]["cleanup"]) {
  return cleanup === undefined
    ? null
    : [cleanup.status, cleanup.summary]
        .filter((value) => value !== undefined && value !== "")
        .join(": ");
}

function reportOutcome(row: z.infer<typeof Report>[number]) {
  return {
    summary: row.result?.summary ?? row.summary ?? "No summary recorded",
    receiptUrl: row.result?.receipt?.url ?? null,
    costUsd: row.aiCostUsd ?? null,
    cleanup: cleanupText(row.cleanup),
  };
}
