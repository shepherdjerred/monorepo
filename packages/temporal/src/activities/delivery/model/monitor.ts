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

const MONITORS_PER_TICK = 20;
const DRIFT_READS_PER_TICK = 50;

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

/** One observation of every watching deployment (W1, W2); failures surface after the rest ran. */
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

/** Self-heals since acceptance become drift evidence on the accepted deployment (T4). */
export async function observeDeliveryDrift() {
  const { applications } = await deliveryRequest(
    "drift/self-healing",
    z.object({ applications: z.array(SelfHealingSchema) }),
  );
  let recorded = 0;
  for (const watched of applications.slice(0, DRIFT_READS_PER_TICK)) {
    const raw = await getArgoApplication(watched.application);
    if (raw === null) continue;
    const drift = selfHealDrift(raw, {
      application: watched.application,
      acceptedAt: watched.acceptedAt,
      observedAt: new Date(),
    });
    if (drift === null) continue;
    await deliveryRequest(
      `${deploymentPath(watched.deploymentId)}/drift`,
      z.unknown(),
      drift,
    );
    recorded += 1;
  }
  return { recorded };
}
