import type { AlertmanagerAlert } from "#lib/alertmanager.ts";

export const FLIPT_FLAG_DRIFT_ALERT_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export type FliptFlagDriftAlertInput = {
  readonly namespace: string;
  readonly environment: string;
  readonly missingInFlipt: readonly string[];
  readonly undeclaredInInventory: readonly string[];
  readonly contractMismatches: readonly string[];
};

function formatKeys(keys: readonly string[]): string {
  return keys.length === 0 ? "none" : keys.join(", ");
}

export function buildFliptFlagDriftAlert(
  input: FliptFlagDriftAlertInput,
  now: Date,
): AlertmanagerAlert {
  const hasDrift =
    input.missingInFlipt.length > 0 ||
    input.undeclaredInInventory.length > 0 ||
    input.contractMismatches.length > 0;
  const startsAt = now.toISOString();
  const summary = hasDrift
    ? `Flipt managed flag inventory drift in ${input.environment}/${input.namespace}`
    : `Flipt managed flag inventory aligned in ${input.environment}/${input.namespace}`;
  const description = hasDrift
    ? [
        `The repository inventory and Flipt differ in ${input.environment}/${input.namespace}.`,
        `Declared keys missing from Flipt: ${formatKeys(input.missingInFlipt)}`,
        `Flipt keys absent from the inventory: ${formatKeys(input.undeclaredInInventory)}`,
        `Behavior contract mismatches: ${formatKeys(input.contractMismatches)}`,
        "Reconcile the reviewed inventory and Flipt state, then run the operator check again.",
      ].join("\n")
    : `The repository inventory and Flipt are aligned in ${input.environment}/${input.namespace}.`;

  return {
    labels: {
      alertname: "FliptManagedFlagDrift",
      severity: "warning",
      component: "feature-flags",
      namespace: input.namespace,
      environment: input.environment,
    },
    annotations: { summary, description, message: description },
    startsAt,
    endsAt: new Date(
      now.getTime() + (hasDrift ? FLIPT_FLAG_DRIFT_ALERT_TTL_MS : 0),
    ).toISOString(),
  };
}
