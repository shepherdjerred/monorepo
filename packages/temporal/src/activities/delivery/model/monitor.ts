import { z } from "zod";
import { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";
import {
  MonitorObservationSchema,
  SelfHealingSchema,
  WatchingMonitorSchema,
  renderMonitorQuery,
  type WatchingMonitor,
} from "@shepherdjerred/delivery/model-contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { getArgoApplication } from "#lib/delivery/argo-client.ts";
import {
  PROMETHEUS_SERVICE_URL,
  alarmQuery,
  firingAlarms,
  monitorWindow,
  selfHealDrift,
} from "#lib/delivery/model/monitor.ts";
import { deploymentPath } from "./stages.ts";

/** Delivery lists watching monitors least recently observed first, so each tick takes the next turns. */
const MONITORS_PER_TICK = 20;

async function observe(client: PrometheusClient, watching: WatchingMonitor) {
  const now = new Date();
  const values = {
    window: monitorWindow(watching.acceptedAt, now),
    version: watching.artifact.version,
    gitSha: watching.artifact.gitSha,
  };
  const alarms = firingAlarms(await client.query(alarmQuery(watching.monitor)));
  const evidence: Record<string, number> = {};
  for (const entry of watching.monitor.evidence)
    evidence[entry.key] =
      (await client.scalar(renderMonitorQuery(entry.query, values))) ?? 0;
  return await deliveryRequest(
    `${deploymentPath(watching.deploymentId)}/monitor/observations`,
    MonitorObservationSchema,
    { observedAt: now.toISOString(), window: values.window, alarms, evidence },
  );
}

/**
 * One observation each of the next watching deployments in turn (W1, W2):
 * the least recently observed, so every one is observed within a few
 * ticks. Failures surface after the rest ran.
 */
export async function observeDeliveryMonitors() {
  const monitors = await deliveryRequest(
    "monitors/watching",
    z.array(WatchingMonitorSchema),
  );
  const client = new PrometheusClient({ baseUrl: PROMETHEUS_SERVICE_URL });
  const outcomes = await Promise.allSettled(
    monitors
      .slice(0, MONITORS_PER_TICK)
      .map(async (watching) => await observe(client, watching)),
  );
  for (const outcome of outcomes)
    if (outcome.status === "rejected") throw outcome.reason;
  return { observed: outcomes.length };
}

async function recordSelfHeal(watched: z.infer<typeof SelfHealingSchema>) {
  const raw = await getArgoApplication(watched.application);
  if (raw === null) return false;
  const drift = selfHealDrift(raw, {
    application: watched.application,
    acceptedAt: watched.acceptedAt,
    observedAt: new Date(),
  });
  if (drift === null) return false;
  await deliveryRequest(
    `${deploymentPath(watched.deploymentId)}/drift`,
    z.unknown(),
    drift,
  );
  return true;
}

/**
 * Self-heals since acceptance become drift evidence on the accepted
 * deployment (T4). Every self-healing Application is read each tick, one at
 * a time, so none is skipped behind the others; failures surface after the
 * rest ran.
 */
export async function observeDeliveryDrift() {
  const { applications } = await deliveryRequest(
    "drift/self-healing",
    z.object({ applications: z.array(SelfHealingSchema) }),
  );
  let recorded = 0;
  const failures: unknown[] = [];
  for (const watched of applications) {
    try {
      if (await recordSelfHeal(watched)) recorded += 1;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      `${String(failures.length)} of ${String(applications.length)} self-healing Application reads failed`,
    );
  return { recorded };
}
