import type { AlertmanagerAlert } from "#lib/alertmanager.ts";

const GENERATOR_URL = "https://github.com/shepherdjerred/monorepo";

/**
 * Mirrors MAIN_VULN_SCAN_ALERT_TTL_MS: the scan is weekly, so a firing
 * occurrence must outlive the cadence or it would self-resolve between runs.
 */
export const LINK_ROT_ALERT_TTL_MS = 8 * 24 * 60 * 60 * 1000;

export type LinkRotAlertInput = {
  /** Number of critical-severity findings this run reported. */
  criticalCount: number;
  /** Commit of main that was scanned. */
  repoSha: string;
};

/**
 * Pure fire/resolve builder for the link-rot scan's Alertmanager occurrence.
 *
 * Kept for symmetry with the vulnerability scan: dead links map to `warning`
 * findings by policy, so in practice every published occurrence resolves and
 * the report email is the sole delivery channel. If the mapping ever produces
 * a critical finding, this path pages without further wiring.
 */
export function buildLinkRotAlert(
  input: LinkRotAlertInput,
  now: Date,
): AlertmanagerAlert {
  const firing = input.criticalCount > 0;
  const shortSha = input.repoSha.slice(0, 12);
  const summary = firing
    ? `link-rot scan: ${String(input.criticalCount)} critical finding(s) on main@${shortSha}`
    : `link-rot scan: no critical findings on main@${shortSha} — earlier finding is resolved`;
  const description = firing
    ? [
        `The weekly lychee scan of main@${shortSha} reported ${String(input.criticalCount)} critical`,
        "finding(s). The full list is in the link-rot-scan report email.",
      ].join("\n")
    : `The weekly lychee scan of main@${shortSha} reported no critical findings.`;
  return {
    labels: {
      alertname: "LinkRotScanCritical",
      severity: "critical",
      component: "link-rot-scan",
    },
    // `message` mirrors `description` — the Alerts template reads either
    // depending on the alert source (see xcode-cloud-webhook.ts).
    annotations: { summary, description, message: description },
    startsAt: now.toISOString(),
    endsAt: new Date(
      now.getTime() + (firing ? LINK_ROT_ALERT_TTL_MS : 0),
    ).toISOString(),
    generatorURL: GENERATOR_URL,
  };
}
