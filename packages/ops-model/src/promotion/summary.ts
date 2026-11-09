import type {
  PromotionBatch,
  PromotionHistoryEntry,
  PromotionOverview,
  PromotionRunRow,
} from "./model.ts";
import { PromotionRunSummarySchema } from "./model.ts";
import { classifyRunSource, type RunState } from "./classification.ts";

type Batch = PromotionBatch & { interrupted: boolean };
type Source = PromotionOverview["sources"][number];
type Entry = PromotionBatch["entries"][number];
type Outcome = PromotionRunRow["outcome"];

function fullRun(batch: Batch, sources: Source[]) {
  if (batch.scope !== undefined) return batch.scope === "all";
  // Legacy journals did not record scope. Only exact inventory coverage proves it.
  const ids = new Set(batch.entries.map((entry) => entry.targetId));
  return (
    ids.size === sources.length && sources.every((source) => ids.has(source.id))
  );
}

function resultFor(
  batch: Batch,
  targetId: string,
  history: PromotionHistoryEntry[],
) {
  return history.find(
    (item) => item.batchId === batch.id && item.targetId === targetId,
  );
}

type Attempt = {
  batch: Batch;
  entry: Entry;
  result: PromotionHistoryEntry | undefined;
};

function attemptFor(
  batch: Batch | undefined,
  source: Source,
  history: PromotionHistoryEntry[],
): Attempt | undefined {
  const entry = batch?.entries.find((item) => item.targetId === source.id);
  return batch === undefined || entry === undefined
    ? undefined
    : { batch, entry, result: resultFor(batch, source.id, history) };
}

function followUp(
  base: Batch | undefined,
  source: Source,
  batches: Batch[],
  history: PromotionHistoryEntry[],
) {
  return base?.entries.some((entry) => entry.targetId === source.id) === true
    ? batches
        .filter(
          (batch) =>
            batch.startedAt > base.startedAt && batch.mode !== "preview",
        )
        .map((batch) => attemptFor(batch, source, history))
        .find(
          (attempt) =>
            attempt !== undefined && attempt.entry.status !== "skipped",
        )
    : undefined;
}

function confirmedAutomation(source: Source, history: PromotionHistoryEntry[]) {
  return (
    source.lastAction?.occurrenceId?.startsWith("local/") === true ||
    source.lastAction?.occurrenceId?.startsWith("storm-promotion/") === true ||
    history.some(
      (item) =>
        item.targetId === source.id &&
        item.mode === "run" &&
        item.status === "verified" &&
        item.timeBasis === "execution" &&
        item.receiptUrl !== null,
    )
  );
}

function description(attempt: Attempt | undefined, source: Source) {
  return (
    [
      attempt?.result?.summary,
      attempt?.entry.summary,
      source.latest?.summary,
      source.notes,
    ].find((text) => text !== undefined && text !== "") ?? "No outcome recorded"
  );
}

function interventionFor(
  state: RunState,
  follow: Attempt | undefined,
  initial: Attempt | undefined,
): PromotionRunRow["intervention"] {
  if (
    follow === undefined ||
    state.outcome !== "done" ||
    state.health === "disabled"
  )
    return null;
  if (follow.entry.phase === "copy-corrected") return "corrected";
  if (follow.batch.mode === "cleanup") return "cleanup";
  const failedFirst =
    initial?.entry.phase === "blocked" ||
    initial?.result?.status === "blocked" ||
    initial?.entry.status === "failed" ||
    initial?.result?.status === "uncertain";
  return failedFirst ? "retried" : null;
}

function finalState(input: {
  state: RunState;
  intervention: PromotionRunRow["intervention"];
  cleanup: string | null;
  targetId: string;
}): RunState {
  const { intervention, cleanup, targetId } = input;
  if (cleanup?.startsWith("blocked") === true)
    return {
      health: "error",
      outcome: "error",
      reason: "Bump succeeded, but reply cleanup failed",
    };
  if (intervention !== null)
    return {
      health: "working",
      outcome: "done",
      reason: "Completed and confirmed",
    };
  return cleanup !== null &&
    targetId === "disboard-native-bump" &&
    input.state.outcome === "done" &&
    cleanup.startsWith("deleted")
    ? { ...input.state, reason: "Bumped; confirmation reply deleted" }
    : input.state;
}

function rowEvidence(
  source: Source,
  attempt: Attempt | undefined,
  initial: Attempt | undefined,
) {
  return {
    receiptUrl:
      attempt?.result?.receiptUrl ?? initial?.result?.receiptUrl ?? null,
    evidenceId:
      attempt?.result?.evidenceId ??
      initial?.result?.evidenceId ??
      source.lastAction?.evidenceId ??
      null,
  };
}

function observedState(
  source: Source,
  attempt: Attempt | undefined,
  history: PromotionHistoryEntry[],
) {
  const entry = attempt?.entry;
  const active = entry?.status === "running" || entry?.status === "queued";
  const status = active
    ? entry.status
    : (attempt?.result?.status ?? entry?.status ?? "not_run");
  const interrupted =
    attempt?.batch.interrupted === true &&
    entry?.status !== "completed" &&
    entry?.status !== "skipped";
  const detail = description(attempt, source);
  const knownGood = confirmedAutomation(source, history);
  return {
    detail,
    knownGood,
    state: classifyRunSource({
      source,
      status,
      phase: entry?.phase ?? "",
      detail,
      interrupted,
      knownGood,
      history,
    }),
  };
}

function runRow(
  source: Source,
  base: Batch | undefined,
  batches: Batch[],
  history: PromotionHistoryEntry[],
): PromotionRunRow {
  const initial = attemptFor(base, source, history);
  const follow = followUp(base, source, batches, history);
  const selected = follow ?? initial;
  const observed = observedState(source, selected, history);
  const intervention = interventionFor(observed.state, follow, initial);
  const cleanup = selected?.result?.cleanup ?? initial?.result?.cleanup ?? null;
  const state = finalState({
    state: observed.state,
    intervention,
    cleanup,
    targetId: source.id,
  });
  const unknownCooldown =
    state.outcome === "not_due" &&
    /no deadline|no.*deadline.*supplied/i.test(observed.detail);
  return {
    targetId: source.id,
    name: source.name,
    platform: source.platform,
    url: source.url,
    ...state,
    detail: observed.detail,
    knownGood: observed.knownGood,
    initialDetail: follow === undefined ? null : description(initial, source),
    intervention,
    ...rowEvidence(source, selected, initial),
    nextAllowedAt: unknownCooldown ? null : source.nextAllowedAt,
  };
}

export function promotionRunSummary(input: {
  sources: Source[];
  batches: Batch[];
  history: PromotionHistoryEntry[];
}) {
  const { sources, history } = input;
  const batches = [...input.batches].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  const runs = batches.filter((batch) => batch.mode === "run");
  const base = runs.find((batch) => fullRun(batch, sources)) ?? runs[0];
  const rows = sources.map((source) => runRow(source, base, batches, history));
  const count = (outcome: Outcome) =>
    rows.filter((row) => row.outcome === outcome).length;
  const counts = {
    done: count("done"),
    notDue: count("not_due"),
    disabled: count("disabled"),
    errors: count("error"),
    interventions: rows.filter((row) => row.intervention !== null).length,
    running: count("running"),
    queued: count("queued"),
    notRun: count("not_run"),
  };
  const followUps =
    base === undefined
      ? []
      : batches.filter(
          (batch) =>
            batch.startedAt > base.startedAt &&
            batch.mode !== "preview" &&
            batch.entries.some((entry) =>
              base.entries.some(
                (original) => original.targetId === entry.targetId,
              ),
            ),
        );
  return PromotionRunSummarySchema.parse({
    batchId: base?.id ?? null,
    scope:
      base === undefined ? null : fullRun(base, sources) ? "all" : "selected",
    startedAt: base?.startedAt ?? null,
    finishedAt: base?.finishedAt ?? null,
    status:
      base === undefined
        ? "not_run"
        : (base.finishedAt === null && !base.interrupted) ||
            counts.running > 0 ||
            counts.queued > 0
          ? "running"
          : base.interrupted
            ? "interrupted"
            : counts.errors > 0
              ? "attention"
              : "passed",
    followUpCount: followUps.length,
    counts,
    rows,
  });
}
