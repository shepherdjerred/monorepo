import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import {
  BuildSummarySchema,
  DeploymentSchema,
  DeploymentStatusSchema,
  IdentifierSchema,
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
const RecoveryRequiredSchema = z.array(
  z.object({
    environment: IdentifierSchema,
    service: IdentifierSchema,
    selfHosted: z.boolean(),
    value: Value,
  }),
);
const EnvironmentValueSchema = z.array(
  z.object({ environment: IdentifierSchema, value: Value }),
);

/**
 * Recovery-required deployments keep their ownership, so each one stalls the
 * self-hosted dispatch barrier (D8): a self-hosted holder blocks every claim,
 * and any holder blocks every self-hosted claim. One series per target makes
 * a new holder a new alert instead of an unchanged value on an old one.
 */
function recoveryRequired(database: Database) {
  return database.$queryRaw`
    SELECT d."environmentId" AS environment, d."serviceId" AS service,
      s."selfHosted" AS "selfHosted", count(*)::float8 AS value
    FROM "Deployment" d JOIN "Service" s ON s.id = d."serviceId"
    WHERE d."recoveryRequired" = true
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
  `;
}

/**
 * How long each environment with a queued deployment has waited to dispatch.
 * A queued deployment waits from its outbox entry, written when it became
 * claimable. A newer set revision superseding a queued automatic request does
 * not restart the wait: a superseded request no later claim in its
 * environment served still counts from its own creation (D3).
 */
function queuedWait(database: Database) {
  return database.$queryRaw`
    WITH queued AS (
      SELECT d."environmentId", MIN(o."createdAt") AS since
      FROM "Deployment" d JOIN "Outbox" o ON o."deploymentId" = d.id
      WHERE d.status = 'queued'
      GROUP BY 1
    ), superseded AS (
      SELECT d."environmentId", MIN(d."createdAt") AS since
      FROM "Deployment" d JOIN queued q ON q."environmentId" = d."environmentId"
      WHERE d.status = 'canceled'
        AND EXISTS (SELECT 1 FROM "Audit" a
          WHERE a."entityId" = d.id AND a.action = 'deployment.superseded')
        AND NOT EXISTS (SELECT 1 FROM "Deployment" c
          WHERE c."environmentId" = d."environmentId" AND c."startedAt" > d."createdAt")
      GROUP BY 1
    )
    SELECT q."environmentId" AS environment,
      GREATEST(EXTRACT(EPOCH FROM (now() - LEAST(q.since, s.since))), 0)::float8 AS value
    FROM queued q LEFT JOIN superseded s ON s."environmentId" = q."environmentId"
    ORDER BY 1
  `;
}

/** Durable count of queued automatic requests a newer set revision canceled (D3). */
function superseded(database: Database) {
  return database.$queryRaw`
    SELECT d."environmentId" AS environment, count(*)::float8 AS value
    FROM "Deployment" d
    WHERE d.status = 'canceled' AND EXISTS (SELECT 1 FROM "Audit" a
      WHERE a."entityId" = d.id AND a.action = 'deployment.superseded')
    GROUP BY 1 ORDER BY 1
  `;
}

/** Database gauges survive restarts; labels are closed enums, never request IDs. */
export async function deliveryMetrics(database: Database): Promise<string> {
  const [
    deployments,
    builds,
    workers,
    raw,
    monitors,
    recoveries,
    waits,
    supersessions,
  ] = await Promise.all([
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
    recoveryRequired(database),
    queuedWait(database),
    superseded(database),
  ]);
  const [state] = z.array(StateSchema).length(1).parse(raw);
  if (state === undefined)
    throw new Error("Delivery metric query returned no state");
  const lines: string[] = [];
  function metric(
    name: string,
    help: string,
    samples: { labels?: Record<string, string>; value: number }[],
    type: "gauge" | "counter" = "gauge",
  ) {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
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
  // `service_id`, not `service`: the scrape's target label already owns `service`.
  metric(
    "delivery_recovery_required_deployments",
    "Recovery-required deployments by environment and catalog service; each holds the dispatch barrier (D8).",
    RecoveryRequiredSchema.parse(recoveries).map((row) => ({
      labels: {
        environment: row.environment,
        service_id: row.service,
        self_hosted: String(row.selfHosted),
      },
      value: row.value,
    })),
  );
  metric(
    "delivery_queued_oldest_seconds",
    "Per environment with a queued deployment, how long its oldest unserved request has waited, across supersession.",
    EnvironmentValueSchema.parse(waits).map((row) => ({
      labels: { environment: row.environment },
      value: row.value,
    })),
  );
  metric(
    "delivery_deployments_superseded_total",
    "Queued automatic deployments canceled before execution by a newer set revision.",
    EnvironmentValueSchema.parse(supersessions).map((row) => ({
      labels: { environment: row.environment },
      value: row.value,
    })),
    "counter",
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
