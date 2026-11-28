import type { AlertmanagerAlert } from "#lib/alertmanager.ts";
import {
  CI_MAINTENANCE_ID,
  CI_MAINTENANCE_KINDS,
  QUEUED_AGE_OUT_MS,
  type CiMaintenanceKind,
} from "#shared/ci-maintenance.ts";

/** A stream blocked this long pages; a shorter block is usually being handled. */
const CI_MAINTENANCE_BLOCKED_ALERT_MS = 30 * 60_000;
/**
 * A pending request with no receipt, or whose age-out cancel has not settled,
 * holds every stream; it pages after this long.
 */
const CI_MAINTENANCE_STALLED_ALERT_MS = 30 * 60_000;
/**
 * A request still queued this long pages unless the latest age-out check
 * found it waiting behind older work in its pool: it is stuck, the check
 * failed, or no check has run.
 */
const CI_MAINTENANCE_QUEUED_ALERT_MS =
  QUEUED_AGE_OUT_MS + CI_MAINTENANCE_STALLED_ALERT_MS;
/**
 * A request the latest check found behind older work pages only this late:
 * the backlog is not canceled, and healthy refreshes have waited close to
 * three hours behind it.
 */
const CI_MAINTENANCE_BACKLOG_ALERT_MS = 8 * 60 * 60_000;
/** Six five-minute ticks without a successful inspection. */
const CI_MAINTENANCE_INSPECTION_ALERT_MS = 30 * 60_000;
/** The golden workspace is stale once its snapshot or its source trails by this much. */
const CI_WORKSPACE_GOLDEN_STALE_MS = 36 * 60 * 60_000;
/**
 * Firing occurrences outlive twelve five-minute ticks, so a missed publish
 * does not resolve them; a healthy tick resolves them explicitly.
 */
export const CI_MAINTENANCE_ALERT_TTL_MS = 60 * 60_000;

const COORDINATOR_URL = `https://temporal-ui.tailnet-1a49.ts.net/namespaces/prod/workflows/${CI_MAINTENANCE_ID}`;
const HOUR_MS = 60 * 60_000;

type BlockedStream = {
  requestId: string;
  reason: string;
  blockedAt?: string | undefined;
};

/** The coordinator memo fields the alerts read. */
export type CiMaintenanceHealthState = {
  blocked: Partial<Record<CiMaintenanceKind, BlockedStream>>;
  pending: {
    kind: CiMaintenanceKind;
    requestId: string;
    pipeline: number | null;
    queuedSince?: string | undefined;
    startedAt?: string | undefined;
    cancelRequestedAt?: string | undefined;
    lastQueueCheck?:
      | "waiting"
      | "not-queued"
      | "canceled"
      | "uncertain"
      | "failed"
      | undefined;
  } | null;
  inspectedAt?: string | undefined;
};

export type GoldenCommit = { sha: string; committedAt: Date };

export type GoldenFreshness =
  | { status: "disabled" }
  | { status: "unselected" }
  | {
      status: "selected";
      snapshot: string;
      /** Undefined when the selected snapshot no longer exists. */
      snapshotCreatedAt: Date | undefined;
      /** Undefined when the selection records no source commit. */
      source: GoldenCommit | undefined;
      main: GoldenCommit;
    };

/** A maintenance flag as Flags answered it; `unknown` when its source failed. */
type FlagState = "on" | "off" | "unknown";

/**
 * Health sources the tick could read. A source that could not be read is
 * left out, and so are its occurrences: they keep their last state in
 * Alertmanager until their TTL instead of resolving on missing data.
 */
export type CiMaintenanceHealthInput = {
  coordinator?: {
    /** Null before the coordinator first runs. */
    state: CiMaintenanceHealthState | null;
    /** Undefined when the dispatch flag could not be read. */
    dispatch: FlagState | undefined;
  };
  golden?: GoldenFreshness;
};

type Problem = { summary: string; description: string };

function occurrence(
  labels: Record<string, string>,
  problem: Problem | undefined,
  resolved: string,
  now: Date,
): AlertmanagerAlert {
  const summary = problem?.summary ?? resolved;
  const description = problem?.description ?? resolved;
  return {
    labels: {
      severity: "warning",
      component: "ci-maintenance",
      temporalNamespace: "prod",
      workflowId: CI_MAINTENANCE_ID,
      ...labels,
    },
    // `message` mirrors `description` — the Alerts template reads either
    // depending on the alert source (see xcode-cloud-webhook.ts).
    annotations: { summary, description, message: description },
    startsAt: now.toISOString(),
    endsAt: new Date(
      now.getTime() + (problem === undefined ? 0 : CI_MAINTENANCE_ALERT_TTL_MS),
    ).toISOString(),
    generatorURL: COORDINATOR_URL,
  };
}

function olderThan(since: string | undefined, now: Date, boundMs: number) {
  return since === undefined || now.getTime() - Date.parse(since) > boundMs;
}

function hours(ms: number) {
  return Math.floor(ms / HOUR_MS).toString();
}

function blockedProblem(
  kind: CiMaintenanceKind,
  entry: BlockedStream | undefined,
  now: Date,
): Problem | undefined {
  // A block recorded before blockedAt existed is at least as old as the field.
  if (
    entry === undefined ||
    !olderThan(entry.blockedAt, now, CI_MAINTENANCE_BLOCKED_ALERT_MS)
  )
    return undefined;
  const input = JSON.stringify({ kind, requestId: entry.requestId });
  return {
    summary: `CI maintenance stream ${kind} is blocked`,
    description: [
      `The ${kind} stream of ${CI_MAINTENANCE_ID} has been blocked since ${entry.blockedAt ?? "before blockedAt was recorded"} and submits nothing until an operator retries it.`,
      `Reason: ${entry.reason}`,
      `Inspect the pipeline, then: toolkit temporal --namespace prod workflow signal --workflow-id ${CI_MAINTENANCE_ID} --name maintenanceRetry --input '${input}'`,
    ].join("\n"),
  };
}

function stalledProblem(
  pending: CiMaintenanceHealthState["pending"],
  now: Date,
): Problem | undefined {
  if (pending?.queuedSince === undefined) return undefined;
  const pipeline = String(pending.pipeline);
  const request = `request ${pending.requestId} (${pending.kind})`;
  if (
    pending.pipeline === null &&
    olderThan(pending.queuedSince, now, CI_MAINTENANCE_STALLED_ALERT_MS)
  )
    return {
      summary: `CI maintenance request for ${pending.kind} has no pipeline receipt`,
      description: [
        `The ${request} was submitted at ${pending.queuedSince} and no Woodpecker pipeline carries its ci-maintenance/ message. Every stream waits behind it.`,
        "Audit Woodpecker for the request ID. Only if the POST created no pipeline, send maintenanceConfirmAbsent with the request ID and evidence, then maintenanceRetry.",
      ].join("\n"),
    };
  if (
    pending.cancelRequestedAt !== undefined &&
    olderThan(pending.cancelRequestedAt, now, CI_MAINTENANCE_STALLED_ALERT_MS)
  )
    return {
      summary: `CI maintenance age-out of ${pending.kind} pipeline ${pipeline} has not settled`,
      description: [
        `At ${pending.cancelRequestedAt} the coordinator canceled pipeline ${pipeline} for ${request} as stuck, or could not confirm the cancel, and never sends it again. Every stream waits behind it.`,
        "Inspect the pipeline; once it ends, the next tick settles the request and rotates to the next stream.",
      ].join("\n"),
    };
  const behindBacklog = pending.lastQueueCheck === "waiting";
  if (
    pending.startedAt === undefined &&
    olderThan(
      pending.queuedSince,
      now,
      behindBacklog
        ? CI_MAINTENANCE_BACKLOG_ALERT_MS
        : CI_MAINTENANCE_QUEUED_ALERT_MS,
    )
  )
    return {
      summary: `CI maintenance ${pending.kind} pipeline ${pipeline} has waited ${hours(now.getTime() - Date.parse(pending.queuedSince))} h without an agent`,
      description: [
        `Pipeline ${pipeline} for ${request} has been queued since ${pending.queuedSince} and no agent has taken it. Every stream waits behind it.`,
        behindBacklog
          ? "The latest check found older work ahead of it in its agent pool, so it keeps its place rather than being canceled; a backlog this long needs CI capacity. Check toolkit ci load."
          : `The latest check (${pending.lastQueueCheck ?? "none yet"}) did not find it simply behind older work: it may be stuck or the check is failing. Read the observation in the coordinator memo.`,
      ].join("\n"),
    };
  return undefined;
}

/**
 * Whether the coordinator has gone 30 minutes without a successful inspection.
 * Coordinators that predate `inspectedAt` are not judged by it.
 */
export function coordinatorInspectionStale(
  state: CiMaintenanceHealthState | null,
  now: Date,
): boolean {
  const inspectedAt = state?.inspectedAt;
  return (
    inspectedAt !== undefined &&
    olderThan(inspectedAt, now, CI_MAINTENANCE_INSPECTION_ALERT_MS)
  );
}

function coordinatorStalledProblem(
  state: CiMaintenanceHealthState | null,
  now: Date,
): Problem | undefined {
  const inspectedAt = state?.inspectedAt;
  if (inspectedAt === undefined || !coordinatorInspectionStale(state, now))
    return undefined;
  return {
    summary: `CI maintenance coordinator has not inspected since ${inspectedAt}`,
    description: [
      `${CI_MAINTENANCE_ID} last completed an inspection at ${inspectedAt}, although dispatch is enabled and the schedule wakes it every five minutes. Its inspections are failing, or its workflow task is stuck (for example on a nondeterminism error).`,
      `Read the observation in its ciMaintenance memo and its pending workflow task: toolkit temporal --namespace prod workflow describe --workflow-id ${CI_MAINTENANCE_ID}`,
    ].join("\n"),
  };
}

function goldenProblems(golden: GoldenFreshness, now: Date): string[] {
  if (golden.status === "disabled") return [];
  if (golden.status === "unselected")
    return [
      "No golden workspace snapshot is selected, so every CI workspace starts empty.",
    ];
  const problems: string[] = [];
  if (golden.snapshotCreatedAt === undefined)
    problems.push(`The selected snapshot ${golden.snapshot} no longer exists.`);
  else if (
    now.getTime() - golden.snapshotCreatedAt.getTime() >
    CI_WORKSPACE_GOLDEN_STALE_MS
  )
    problems.push(
      `The selected snapshot ${golden.snapshot} was taken ${hours(now.getTime() - golden.snapshotCreatedAt.getTime())} h ago.`,
    );
  if (golden.source === undefined)
    problems.push(`The selection records no source commit.`);
  else if (
    golden.main.committedAt.getTime() - golden.source.committedAt.getTime() >
    CI_WORKSPACE_GOLDEN_STALE_MS
  )
    problems.push(
      `Its source ${golden.source.sha.slice(0, 12)} trails main ${golden.main.sha.slice(0, 12)} by ${hours(golden.main.committedAt.getTime() - golden.source.committedAt.getTime())} h.`,
    );
  return problems;
}

function goldenProblem(
  golden: GoldenFreshness,
  now: Date,
): Problem | undefined {
  const problems = goldenProblems(golden, now);
  if (problems.length === 0) return undefined;
  return {
    summary: "CI golden workspace is stale",
    description: [
      ...problems,
      "Workspaces clone the golden snapshot and install the difference; a stale one makes every CI workspace rewrite its dependencies.",
      `Check the workspace-golden stream in the ${CI_MAINTENANCE_ID} memo and the ci-workspace-golden ConfigMap in woodpecker-ci.`,
    ].join("\n"),
  };
}

function coordinatorAlerts(
  coordinator: NonNullable<CiMaintenanceHealthInput["coordinator"]>,
  now: Date,
): AlertmanagerAlert[] {
  const state = coordinator.state;
  const alerts = [
    ...CI_MAINTENANCE_KINDS.map((kind) =>
      occurrence(
        { alertname: "CiMaintenanceStreamBlocked", stream: kind },
        blockedProblem(kind, state?.blocked[kind], now),
        `CI maintenance stream ${kind} is not blocked`,
        now,
      ),
    ),
    occurrence(
      { alertname: "CiMaintenanceRequestStalled" },
      stalledProblem(state?.pending ?? null, now),
      "No CI maintenance request is stalled",
      now,
    ),
  ];
  // With dispatch off the schedule never wakes the coordinator; with the
  // flag unknown its silence means nothing either way.
  if (coordinator.dispatch === "on" || coordinator.dispatch === "off")
    alerts.push(
      occurrence(
        { alertname: "CiMaintenanceCoordinatorStalled" },
        coordinator.dispatch === "on"
          ? coordinatorStalledProblem(state, now)
          : undefined,
        coordinator.dispatch === "on"
          ? "CI maintenance coordinator is inspecting"
          : "CI maintenance dispatch is disabled",
        now,
      ),
    );
  return alerts;
}

/**
 * Pure fire/resolve builder for CI maintenance health. Every tick publishes
 * one occurrence per fixed label set it could evaluate, firing (endsAt = now
 * + TTL) while the problem holds and resolving (endsAt = startsAt) once it
 * clears, so Alertmanager deduplicates by labels and recovery clears the page.
 */
export function buildCiMaintenanceAlerts(
  input: CiMaintenanceHealthInput,
  now: Date,
): AlertmanagerAlert[] {
  const golden = input.golden;
  return [
    ...(input.coordinator === undefined
      ? []
      : coordinatorAlerts(input.coordinator, now)),
    ...(golden === undefined
      ? []
      : [
          occurrence(
            { alertname: "CiWorkspaceGoldenStale", stream: "workspace-golden" },
            goldenProblem(golden, now),
            golden.status === "disabled"
              ? "CI golden workspace refresh is disabled"
              : "CI golden workspace is fresh",
            now,
          ),
        ]),
  ];
}

/** True while the occurrence is firing rather than resolving. */
export function isFiringAlert(alert: AlertmanagerAlert) {
  return alert.endsAt !== alert.startsAt;
}
