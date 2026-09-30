import type { ArgoApplication } from "@shepherdjerred/ops-clients/kubernetes.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import {
  worstSeverity,
  type Severity,
} from "@shepherdjerred/ops-model/severity.ts";
import type {
  ChangeEventInput,
  Link,
  SignalInput,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { argoAppLink, logsLink, MONOREPO_URL } from "./ops-links.ts";
import {
  hoursSince,
  metric,
  minutesSince,
  truncate,
  type OpsCollection,
  type OpsContext,
} from "./ops-types.ts";

/** Deploys and syncs older than this are not re-sent as change events. */
const CHANGE_WINDOW_HOURS = 24;

const HEALTH_SEVERITY: Record<ArgoApplication["health"], Severity> = {
  Healthy: "ok",
  Progressing: "info",
  Suspended: "info",
  Missing: "warning",
  Degraded: "error",
  Unknown: "unknown",
};

const FAILED_OPERATION_PHASES = new Set(["Failed", "Error"]);

export type ArgoAppState = {
  severity: Severity;
  needsMe: boolean;
  reasons: string[];
};

/**
 * Severity of one Application. OutOfSync is a warning only once it has
 * outlasted the grace period with no sync operation running; a failed sync
 * operation is an error the operator must act on.
 */
export function argoAppState(
  app: ArgoApplication,
  outOfSyncSince: Date | undefined,
  now: Date,
): ArgoAppState {
  const reasons: string[] = [];
  const severities: Severity[] = [HEALTH_SEVERITY[app.health]];
  if (app.health !== "Healthy") {
    reasons.push(app.health);
  }
  const operationRunning = app.operation?.phase === "Running";
  if (app.sync === "OutOfSync") {
    reasons.push("OutOfSync");
    const graceOver =
      outOfSyncSince !== undefined &&
      minutesSince(outOfSyncSince.toISOString(), now) >=
        OPS_POLICY.argoOutOfSyncGraceMinutes;
    severities.push(graceOver && !operationRunning ? "warning" : "info");
  } else if (app.sync === "Unknown") {
    reasons.push("sync Unknown");
    severities.push("unknown");
  }
  const failed =
    app.operation !== undefined &&
    FAILED_OPERATION_PHASES.has(app.operation.phase);
  if (failed) {
    reasons.push(`sync ${app.operation?.phase ?? ""}`.trim());
    severities.push("error");
  }
  return { severity: worstSeverity(severities), needsMe: failed, reasons };
}

function commitLink(revision: string | undefined): Link[] {
  return revision === undefined || !/^[0-9a-f]{7,40}$/u.test(revision)
    ? []
    : [
        {
          kind: "github",
          label: `Commit ${revision.slice(0, 7)}`,
          url: `${MONOREPO_URL}/commit/${revision}`,
        },
      ];
}

function appChanges(
  app: ArgoApplication,
  service: string | undefined,
  now: Date,
): ChangeEventInput[] {
  const changes: ChangeEventInput[] = app.history
    .filter((entry) => hoursSince(entry.deployedAt, now) <= CHANGE_WINDOW_HOURS)
    .map((entry) => ({
      source: "argocd",
      externalId: `${app.name}:deploy:${String(entry.id)}`,
      kind: "deploy",
      ...(service === undefined ? {} : { service }),
      title: `${app.name} deployed ${entry.revision?.slice(0, 7) ?? "(no revision)"}`,
      occurredAt: new Date(Date.parse(entry.deployedAt)).toISOString(),
      severity: "info",
      url: argoAppLink(app.name).url,
    }));
  const operation = app.operation;
  if (
    operation !== undefined &&
    FAILED_OPERATION_PHASES.has(operation.phase) &&
    hoursSince(operation.startedAt, now) <= CHANGE_WINDOW_HOURS
  ) {
    changes.push({
      source: "argocd",
      externalId: `${app.name}:sync:${operation.startedAt}`,
      kind: "sync",
      ...(service === undefined ? {} : { service }),
      title: `${app.name} sync ${operation.phase}`,
      occurredAt: new Date(
        Date.parse(operation.finishedAt ?? operation.startedAt),
      ).toISOString(),
      severity: "error",
      url: argoAppLink(app.name).url,
    });
  }
  return changes;
}

export function mapArgoApplications(
  apps: readonly ArgoApplication[],
  outOfSyncSince: ReadonlyMap<string, Date>,
  context: OpsContext,
): OpsCollection {
  const signals: SignalInput[] = [];
  const changes: ChangeEventInput[] = [];
  let unhealthy = 0;
  for (const app of apps) {
    const service = context.services.byArgoApp(app.name)?.id;
    changes.push(...appChanges(app, service, context.now));
    if (app.health === "Degraded" || app.health === "Missing") {
      unhealthy += 1;
    }
    const state = argoAppState(app, outOfSyncSince.get(app.name), context.now);
    if (state.reasons.length === 0) {
      continue;
    }
    const since = outOfSyncSince.get(app.name);
    signals.push({
      id: `argocd:app:${app.name}`,
      source: "argocd",
      section: "platform",
      ...(service === undefined ? {} : { service }),
      kind: "argo-app",
      severity: state.severity,
      needsMe: state.needsMe,
      title: `${app.name}: ${state.reasons.join(", ")}`,
      ...(app.operation?.message === undefined || !state.needsMe
        ? {}
        : { detail: truncate(app.operation.message, 500) }),
      ...(since === undefined ? {} : { since: since.toISOString() }),
      attributes: {
        sync: app.sync,
        health: app.health,
        ...(app.operation === undefined
          ? {}
          : { operation: app.operation.phase }),
      },
      links: [
        argoAppLink(app.name),
        ...commitLink(app.revision),
        ...(app.destinationNamespace === undefined
          ? []
          : [logsLink(app.destinationNamespace)]),
      ],
    });
  }
  return {
    signals,
    metrics: [
      metric({
        section: "platform",
        source: "argocd",
        id: METRIC_IDS.argoAppsUnhealthy,
        label: "Unhealthy apps",
        value: unhealthy,
        unit: "count",
      }),
      metric({
        section: "platform",
        source: "argocd",
        id: METRIC_IDS.argoAppsOutOfSync,
        label: "Out of sync",
        value: apps.filter((app) => app.sync === "OutOfSync").length,
        unit: "count",
      }),
    ],
    changes,
  };
}

/**
 * Track when each app was first observed OutOfSync. Argo does not record it,
 * so the collector keeps it in process memory: a worker restart restarts the
 * grace period, which delays a warning but never hides one for longer.
 */
export function updateOutOfSyncSince(
  tracker: Map<string, Date>,
  apps: readonly ArgoApplication[],
  now: Date,
): void {
  const outOfSync = new Set(
    apps.filter((app) => app.sync === "OutOfSync").map((app) => app.name),
  );
  for (const name of tracker.keys()) {
    if (!outOfSync.has(name)) {
      tracker.delete(name);
    }
  }
  for (const name of outOfSync) {
    if (!tracker.has(name)) {
      tracker.set(name, now);
    }
  }
}
