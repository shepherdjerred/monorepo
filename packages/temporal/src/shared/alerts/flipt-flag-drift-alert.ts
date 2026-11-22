import type { AlertmanagerAlert } from "#lib/alertmanager.ts";

export const FLIPT_FLAG_DRIFT_ALERT_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export type FliptFlagDriftAlertInput = {
  readonly deployment: string;
  readonly namespace: string;
  readonly environment: string;
  readonly missingFlags: readonly string[];
  readonly extraFlags: readonly string[];
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
    input.missingFlags.length > 0 ||
    input.extraFlags.length > 0 ||
    input.contractMismatches.length > 0;
  const startsAt = now.toISOString();
  const summary = hasDrift
    ? `Flags managed inventory drift in ${input.deployment}`
    : `Flags managed inventory aligned in ${input.deployment}`;
  const description = hasDrift
    ? [
        `The repository inventory and live Flags document differ in ${input.deployment}.`,
        `Declared keys missing from Flags: ${formatKeys(input.missingFlags)}`,
        `Live keys absent from the inventory: ${formatKeys(input.extraFlags)}`,
        `Behavior contract mismatches: ${formatKeys(input.contractMismatches)}`,
        "Missing declared keys are created automatically. Remaining drift is live targeting or undeclared keys; update the inventory or the audited deployment state.",
      ].join("\n")
    : `The repository inventory and live Flags document are aligned in ${input.deployment}.`;

  return {
    labels: {
      alertname: "FliptManagedFlagDrift",
      severity: "warning",
      component: "feature-flags",
      deployment: input.deployment,
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
