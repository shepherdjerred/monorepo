import { DeliveryError } from "#domain/error.ts";
import {
  PipelineRevisionSchema,
  type EvidenceInput,
  type Principal,
} from "#shared/contract.ts";
import {
  MonitorObservationInputSchema,
  MonitorObservationSchema,
  MonitorStatusSchema,
  WatchingMonitorSchema,
  monitorOutcome,
  type FiringAlarm,
  type Monitor,
  type MonitorObservationInput,
  type WatchingMonitor,
} from "#shared/model/monitor-contract.ts";
import { monitorOf } from "#shared/model/recipe-view.ts";
import type { Database } from "#infrastructure/database.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  evidence,
  id,
  version,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import {
  audit,
  lock,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";

async function recipeMonitor(tx: Transaction | Database, recipeId: string) {
  return monitorOf(
    PipelineRevisionSchema.parse(
      wire(
        required(
          await tx.pipeline.findUnique({ where: { id: recipeId } }),
          "Recipe",
        ),
      ),
    ).definition,
  );
}

/**
 * W1: acceptance starts the monitor the frozen recipe declares; without one
 * the selection settles on acceptance and is recorded as unmonitored.
 */
export async function startMonitor(
  tx: Transaction,
  row: { pipelineRevisionId: string },
  now: Date,
) {
  return (await recipeMonitor(tx, row.pipelineRevisionId)) === null
    ? { monitorState: "unmonitored", monitorSettledAt: now }
    : { monitorState: "watching", monitorSettledAt: null };
}

/** Every accepted deployment still watching, with what the executor needs to render its queries. */
export async function watchingMonitors(
  this: Delivery,
): Promise<WatchingMonitor[]> {
  const rows = await this.database.deployment.findMany({
    where: { monitorState: "watching", acceptedBy: { some: {} } },
    orderBy: { finishedAt: "asc" },
  });
  const watching: WatchingMonitor[] = [];
  for (const row of rows) {
    const monitor = required(
      await recipeMonitor(this.database, row.pipelineRevisionId),
      "Declared monitor",
    );
    const selected = await version(this.database, row.versionSetRevisionId);
    const artifact = required(
      selected.components[monitor.component] ?? null,
      `Monitored component ${monitor.component}`,
    );
    watching.push(
      WatchingMonitorSchema.parse({
        deploymentId: row.id,
        environmentId: row.environmentId,
        serviceId: row.serviceId,
        acceptedAt: required(row.finishedAt, "Acceptance time").toISOString(),
        monitor,
        artifact: {
          component: monitor.component,
          version: artifact.version,
          gitSha: artifact.sourceRevision,
          digest: artifact.digest,
        },
      }),
    );
  }
  return watching;
}

/**
 * Alarms count against a deployment only from its claim on (W2): an alert
 * already active before then is pre-existing, recorded as evidence, and
 * neither rolls back nor blocks settlement.
 */
export function partitionAlarms(
  alarms: readonly FiringAlarm[],
  claimedAt: Date,
): { counted: FiringAlarm[]; preExisting: FiringAlarm[] } {
  const counted: FiringAlarm[] = [];
  const preExisting: FiringAlarm[] = [];
  for (const alarm of alarms)
    (Date.parse(alarm.activeAt) >= claimedAt.getTime()
      ? counted
      : preExisting
    ).push(alarm);
  return { counted, preExisting };
}

/** One alarm as evidence; identical across observations so a firing alert is recorded once. */
function alarmEvidence(
  alarms: readonly FiringAlarm[],
  preExisting: boolean,
): EvidenceInput[] {
  return alarms.map((alarm) => ({
    kind: "alarm",
    summary: JSON.stringify({
      alertname: alarm.alertname,
      severity: alarm.severity,
      labels: alarm.labels,
      activeAt: alarm.activeAt,
      preExisting,
    }),
  }));
}

function observationView(row: {
  deploymentId: string;
  sequence: number;
  observedAt: Date;
  window: string;
  alarms: unknown;
  evidence: unknown;
  outcome: string;
  createdAt: Date;
}) {
  return MonitorObservationSchema.parse(
    wire({ ...row, id: `${row.deploymentId}/monitor/${String(row.sequence)}` }),
  );
}

async function markSettled(
  tx: Transaction,
  row: { id: string },
  input: { sequence: number; observation: MonitorObservationInput },
  monitor: Monitor,
) {
  await evidence(
    tx,
    row.id,
    [
      {
        kind: "monitor",
        summary: JSON.stringify({
          window: input.observation.window,
          evidence: input.observation.evidence,
          thresholds: Object.fromEntries(
            monitor.evidence.map((entry) => [entry.key, entry.threshold]),
          ),
        }),
      },
    ],
    { prefix: `monitor/${String(input.sequence)}`, appendOnly: true },
  );
  await tx.deployment.update({
    where: { id: row.id },
    data: { monitorState: "settled", monitorSettledAt: new Date() },
  });
}

async function markAlarmed(
  tx: Transaction,
  row: { id: string; environmentId: string; versionSetRevisionId: string },
) {
  const env = await tx.environment.findUniqueOrThrow({
    where: { id: row.environmentId },
  });
  const alarmed = await tx.versionSet.findUniqueOrThrow({
    where: { id: row.versionSetRevisionId },
  });
  await tx.environment.update({
    where: { id: env.id },
    data: {
      automaticSuppressedThroughRevision: Math.max(
        env.automaticSuppressedThroughRevision,
        alarmed.revision,
      ),
    },
  });
  await tx.deployment.update({
    where: { id: row.id },
    data: { monitorState: "alarmed", monitorAlarmedAt: new Date() },
  });
}

/**
 * Record one observation of a watching deployment (W1, W2, V3). An alarm
 * active since the claim suppresses automatic selection of the alarmed set
 * revision (D3); settling records the evidence counts that met the
 * threshold. Pre-existing alarms are evidence only.
 */
export async function observeMonitor(
  this: Delivery,
  deploymentId: string,
  raw: MonitorObservationInput,
  actor: Principal,
) {
  const input = MonitorObservationInputSchema.parse(raw);
  return this.database.$transaction(async (tx) => {
    await lock(tx, `deployment:${deploymentId}`);
    const row = required(
      await tx.deployment.findUnique({ where: { id: deploymentId } }),
      "Deployment",
    );
    const env = await tx.environment.findUniqueOrThrow({
      where: { id: row.environmentId },
    });
    if (env.acceptedDeploymentId !== row.id || row.monitorState !== "watching")
      throw new DeliveryError(
        "CONFLICT",
        "Only the accepted deployment's watching monitor takes observations",
      );
    const monitor = required(
      await recipeMonitor(tx, row.pipelineRevisionId),
      "Declared monitor",
    );
    const { counted, preExisting } = partitionAlarms(
      input.alarms,
      required(row.startedAt, "Claim time"),
    );
    const outcome = monitorOutcome(monitor, { ...input, alarms: counted });
    const sequence =
      (await tx.monitorObservation.count({ where: { deploymentId } })) + 1;
    const created = await tx.monitorObservation.create({
      data: {
        deploymentId,
        sequence,
        observedAt: new Date(input.observedAt),
        window: input.window,
        alarms: input.alarms,
        evidence: input.evidence,
        outcome,
      },
    });
    await evidence(
      tx,
      deploymentId,
      [...alarmEvidence(preExisting, true), ...alarmEvidence(counted, false)],
      { prefix: "monitor/alarms", appendOnly: true },
    );
    if (outcome === "alarmed") await markAlarmed(tx, row);
    else if (outcome === "settled")
      await markSettled(tx, row, { sequence, observation: input }, monitor);
    if (outcome !== "watching")
      await audit(tx, actor, {
        action: `monitor.${outcome}`,
        entityId: deploymentId,
        requestId: id(),
        metadata: { sequence, alarms: counted, policy: monitor.policy },
      });
    return { observation: observationView(created), policy: monitor.policy };
  });
}

/** The monitor state of an environment's accepted selection (4.19). */
export async function monitorStatus(this: Delivery, environmentId: string) {
  const env = await this.database.environment.findUniqueOrThrow({
    where: { id: environmentId },
  });
  if (env.acceptedDeploymentId === null)
    return MonitorStatusSchema.parse({
      deploymentId: null,
      state: "unmonitored",
      policy: null,
      settledAt: null,
      alarmedAt: null,
      observations: 0,
      monitor: null,
      latestObservation: null,
    });
  const row = await this.database.deployment.findUniqueOrThrow({
    where: { id: env.acceptedDeploymentId },
  });
  const monitor = await recipeMonitor(this.database, row.pipelineRevisionId);
  const [observations, latest] = await Promise.all([
    this.database.monitorObservation.count({
      where: { deploymentId: row.id },
    }),
    this.database.monitorObservation.findFirst({
      where: { deploymentId: row.id },
      orderBy: { sequence: "desc" },
    }),
  ]);
  return MonitorStatusSchema.parse({
    deploymentId: row.id,
    state: row.monitorState ?? "unmonitored",
    policy: monitor?.policy ?? null,
    settledAt: row.monitorSettledAt?.toISOString() ?? null,
    alarmedAt: row.monitorAlarmedAt?.toISOString() ?? null,
    observations,
    monitor,
    latestObservation: latest === null ? null : observationView(latest),
  });
}
