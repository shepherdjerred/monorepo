/**
 * Alertmanager's side of Hub's Incidents auto-open: the alertnames that open
 * or attach to an incident, and the receiver that delivers them to Hub.
 *
 * The Incidents module maps each alertname to its system and severity and
 * rejects one it does not know, so this route must name exactly the
 * alertnames its rules cover.
 */

// The Incidents package owns these values (`@shepherdjerred/incidents/alert-rules`).
// They are restated here so the cdk8s runtime closure, which several images
// copy, does not depend on the Incidents package; `incidents-alerts.test.ts`
// fails when the two drift.
export const INCIDENT_ALERTNAMES = [
  "DeliveryUnavailable",
  "DeliveryRecoveryRequired",
  "DeliveryContentBarrierStuck",
  "DeliveryDispatchDelayed",
  "DeliveryQueueStalled",
  "DeliveryPlatformLockStranded",
  "DeliveryRecoveryIntentsPending",
] as const;

export const INCIDENT_ALERT_RECEIVER = "incidents";

/** Hub's Incidents Alertmanager webhook path. */
export const INCIDENT_ALERTMANAGER_PATH = "/api/incidents/alertmanager";

/**
 * First child route. `continue: true` lets the same alert keep evaluating the
 * routes after it, so it still reaches the Alerts ledger, mail fallback, or
 * null suppression exactly as it did before Incidents existed.
 */
export const INCIDENTS_ROUTE = {
  receiver: INCIDENT_ALERT_RECEIVER,
  matchers: [`alertname =~ "${INCIDENT_ALERTNAMES.join("|")}"`],
  continue: true,
};
