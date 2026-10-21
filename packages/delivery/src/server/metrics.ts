import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import {
  BuildSummarySchema,
  DeploymentSchema,
  DeploymentStatusSchema,
  MonitorStateSchema,
} from "#shared/contract.ts";

const Value = z.number().nonnegative();
const StateSchema = z.object({
  outboxPending: Value,
  outboxAge: Value,
  locks: Value,
  lockAge: Value,
  recoveryRequired: Value,
  recoveriesPending: Value,
});

/** Database gauges survive restarts; labels are closed enums, never request IDs. */
export async function deliveryMetrics(database: Database): Promise<string> {
  const [deployments, builds, workers, raw, monitors] = await Promise.all([
    database.deployment.groupBy({
      by: ["status", "kind"],
      _count: { _all: true },
      orderBy: [{ status: "asc" }, { kind: "asc" }],
    }),
    database.build.groupBy({
      by: ["status", "sourceKind"],
      _count: { _all: true },
      orderBy: [{ status: "asc" }, { sourceKind: "asc" }],
    }),
    database.workerVersion.groupBy({
      by: ["replicas"],
      _count: { _all: true },
      orderBy: { replicas: "asc" },
    }),
    database.$queryRaw`
      SELECT
        (SELECT count(*)::float8 FROM "Outbox" o JOIN "Deployment" d ON d.id = o."deploymentId"
          WHERE o."submittedAt" IS NULL AND d.status NOT IN ('succeeded','failed','canceled')) AS "outboxPending",
        (SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN(o."createdAt"))),0)::float8
          FROM "Outbox" o JOIN "Deployment" d ON d.id = o."deploymentId"
          WHERE o."submittedAt" IS NULL AND d.status NOT IN ('succeeded','failed','canceled')) AS "outboxAge",
        (SELECT count(*)::float8 FROM "TargetLock") AS locks,
        (SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN("acquiredAt"))),0)::float8 FROM "TargetLock") AS "lockAge",
        (SELECT count(*)::float8 FROM "Deployment" WHERE "recoveryRequired" = true) AS "recoveryRequired",
        (SELECT count(*)::float8 FROM "RecoveryIntent" WHERE status = 'pending' OR
           (barrier IS NOT NULL AND "barrierRestoredAt" IS NULL)) AS "recoveriesPending"
    `,
    // One series per environment with an accepted selection (4.19).
    database.environment.findMany({
      where: { acceptedDeploymentId: { not: null } },
      select: {
        id: true,
        acceptedDeployment: { select: { monitorState: true } },
      },
      orderBy: { id: "asc" },
    }),
  ]);
  const [state] = z.array(StateSchema).length(1).parse(raw);
  if (state === undefined)
    throw new Error("Delivery metric query returned no state");
  const lines: string[] = [];
  function metric(
    name: string,
    help: string,
    samples: { labels?: Record<string, string>; value: number }[],
  ) {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
    for (const sample of samples) {
      const labels = Object.entries(sample.labels ?? {})
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(",");
      lines.push(
        `${name}${labels === "" ? "" : `{${labels}}`} ${String(Value.parse(sample.value))}`,
      );
    }
  }
  metric(
    "delivery_deployments",
    "Recorded deployments by current result and operation kind.",
    deployments.map((row) => ({
      labels: {
        status: DeploymentStatusSchema.parse(row.status),
        kind: DeploymentSchema.shape.kind.parse(row.kind),
      },
      value: row._count._all,
    })),
  );
  metric(
    "delivery_builds",
    "Recorded artifact builds by qualification and original source kind.",
    builds.map((row) => ({
      labels: {
        status: BuildSummarySchema.shape.status.parse(row.status),
        source_kind: BuildSummarySchema.shape.sourceKind.parse(row.sourceKind),
      },
      value: row._count._all,
    })),
  );
  metric(
    "delivery_worker_hosts",
    "Retained worker records including zero-replica history.",
    workers.map((row) => ({
      labels: {
        desired_replicas: String(
          z.union([z.literal(0), z.literal(1)]).parse(row.replicas),
        ),
      },
      value: row._count._all,
    })),
  );
  metric(
    "delivery_monitor_state",
    "Monitor state of each environment's accepted selection (1 for its current state).",
    monitors.map((row) => ({
      labels: {
        environment: row.id,
        state: MonitorStateSchema.parse(row.acceptedDeployment?.monitorState),
      },
      value: 1,
    })),
  );
  for (const [name, help, value] of [
    [
      "delivery_outbox_pending",
      "Nonterminal deployment submissions awaiting durable acknowledgement.",
      state.outboxPending,
    ],
    [
      "delivery_outbox_oldest_seconds",
      "Age of the oldest unacknowledged nonterminal deployment submission.",
      state.outboxAge,
    ],
    [
      "delivery_application_locks",
      "Held target instance locks (model T1).",
      state.locks,
    ],
    [
      "delivery_application_lock_oldest_seconds",
      "Age of the oldest held target instance lock.",
      state.lockAge,
    ],
    [
      "delivery_recovery_required",
      "Deployments requiring independent external-state inspection.",
      state.recoveryRequired,
    ],
    [
      "delivery_independent_recoveries_pending",
      "Independent recovery intents or journaled producer restorations still requiring settlement.",
      state.recoveriesPending,
    ],
  ] as const)
    metric(name, help, [{ value }]);
  return `${lines.join("\n")}\n`;
}
