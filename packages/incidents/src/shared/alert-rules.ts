/**
 * Curated Alertmanager alerts that open or attach to incidents. This table is
 * the single source for the Hub receiver's mapping and for the homelab
 * Alertmanager route that sends these alertnames to
 * `/api/incidents/alertmanager`; an alertname missing here is ignored by the
 * receiver even when routed.
 */
import type { IncidentSeverity, IncidentSystem } from "#shared/contract.ts";

export const INCIDENT_ALERT_RECEIVER = "incidents";
export const INCIDENT_ALERTMANAGER_PATH = "/api/incidents/alertmanager";

export const INCIDENT_ALERTNAMES = [
  "DeliveryUnavailable",
  "DeliveryRecoveryRequired",
  "DeliveryContentBarrierStuck",
  "DeliveryDispatchDelayed",
  "DeliveryQueueStalled",
  "DeliveryPlatformLockStranded",
  "DeliveryRecoveryIntentsPending",
] as const;
export type IncidentAlertname = (typeof INCIDENT_ALERTNAMES)[number];

export type IncidentAlertRule = {
  readonly system: IncidentSystem;
  readonly severity: IncidentSeverity;
  readonly exitCondition: string;
  /** Why this severity: what the alert blocks while it fires. */
  readonly reason: string;
};

export const INCIDENT_ALERT_RULES: Readonly<
  Record<IncidentAlertname, IncidentAlertRule>
> = {
  DeliveryUnavailable: {
    system: "delivery",
    severity: "sev1",
    reason:
      "The control plane is down, so no release can be submitted or recovered.",
    exitCondition:
      "DeliveryUnavailable has resolved and `toolkit deploy status --json` answers with a healthy control plane.",
  },
  DeliveryRecoveryRequired: {
    system: "delivery",
    severity: "sev1",
    reason:
      "A recovery-required holder keeps the dispatch barrier and never clears on its own.",
    exitCondition:
      "The recovery-required deployment is settled through its recovery reader, DeliveryRecoveryRequired has resolved, and the queued deployments dispatch.",
  },
  DeliveryContentBarrierStuck: {
    system: "delivery",
    severity: "sev1",
    reason:
      "Every Delivery claim answers BUSY until the content producer barrier is restored.",
    exitCondition:
      "The content recovery intent is finished or restored, DeliveryContentBarrierStuck has resolved, and Delivery claims succeed again.",
  },
  DeliveryDispatchDelayed: {
    system: "delivery",
    severity: "sev2",
    reason:
      "Releases are late but no submission is lost; the outbox still holds them.",
    exitCondition:
      "The outbox drains to Temporal and DeliveryDispatchDelayed has resolved.",
  },
  DeliveryQueueStalled: {
    system: "delivery",
    severity: "sev2",
    reason:
      "One environment's queue is stuck behind an unbounded holder; other environments may still ship.",
    exitCondition:
      "The stalled environment's queued deployment is claimed and DeliveryQueueStalled has resolved.",
  },
  DeliveryPlatformLockStranded: {
    system: "delivery",
    severity: "sev2",
    reason:
      "Only platform deployments (OpenTofu, admission, control plane) are blocked; workloads still ship.",
    exitCondition:
      "The platform lock is released by the dispatch sweep and DeliveryPlatformLockStranded has resolved.",
  },
  DeliveryRecoveryIntentsPending: {
    system: "delivery",
    severity: "sev3",
    reason:
      "Blocks control-plane upgrades and the ownership handover; ordinary deployments proceed.",
    exitCondition:
      "Every pending recovery intent is settled or abandoned and DeliveryRecoveryIntentsPending has resolved.",
  },
};

const RULES_BY_ALERTNAME: ReadonlyMap<string, IncidentAlertRule> = new Map(
  Object.entries(INCIDENT_ALERT_RULES),
);

/** The rule for a routed alertname, or null when the alert is not curated. */
export function incidentAlertRule(alertname: string): IncidentAlertRule | null {
  return RULES_BY_ALERTNAME.get(alertname) ?? null;
}
