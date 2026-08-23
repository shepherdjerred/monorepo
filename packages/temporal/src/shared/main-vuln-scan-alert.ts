import type { AlertmanagerAlert } from "#lib/alertmanager.ts";

const GENERATOR_URL = "https://github.com/shepherdjerred/monorepo";

/**
 * How long a critical-vulnerability alert stays firing without being re-fired.
 * The scan runs weekly, so anything shorter would let the alert resolve itself
 * between runs; eight days keeps it alive until the next run either re-fires
 * or explicitly resolves it. Mirrors LLM_CATALOG_WITHHELD_ALERT_TTL_MS.
 */
export const MAIN_VULN_SCAN_ALERT_TTL_MS = 8 * 24 * 60 * 60 * 1000;

export type MainVulnScanAlertInput = {
  /** Number of CRITICAL-severity vulnerabilities this run found. */
  criticalCount: number;
  /** Commit of main that was scanned. */
  repoSha: string;
};

/**
 * Pure fire/resolve builder for the weekly scan's Alertmanager occurrence.
 *
 * Every run publishes exactly one occurrence under a fixed label set:
 * firing (endsAt = now + TTL) while at least one CRITICAL vulnerability is
 * present, resolving (endsAt = startsAt) the moment a run finds none — so a
 * remediated scan clears the page instead of leaving it to age out over eight
 * days. HIGH findings deliberately do not page: the report email carries them,
 * and only `critical` routes.
 */
export function buildMainVulnScanAlert(
  input: MainVulnScanAlertInput,
  now: Date,
): AlertmanagerAlert {
  const firing = input.criticalCount > 0;
  const shortSha = input.repoSha.slice(0, 12);
  const summary = firing
    ? `main vulnerability scan: ${String(input.criticalCount)} CRITICAL finding(s) on main@${shortSha}`
    : `main vulnerability scan: no CRITICAL findings on main@${shortSha} — earlier finding is resolved`;
  const description = firing
    ? [
        `The weekly Trivy scan of main@${shortSha} found ${String(input.criticalCount)} CRITICAL`,
        "vulnerability finding(s). The full list (with affected packages and fixed",
        "versions) is in the main-vuln-scan report email. Upgrade the affected",
        "packages or record a justified ignore in .trivyignore.",
      ].join("\n")
    : `The weekly Trivy scan of main@${shortSha} found no CRITICAL vulnerabilities.`;
  return {
    labels: {
      alertname: "MainVulnScanCritical",
      severity: "critical",
      component: "main-vuln-scan",
    },
    // `message` mirrors `description` — the Alerts template reads either
    // depending on the alert source (see xcode-cloud-webhook.ts).
    annotations: { summary, description, message: description },
    startsAt: now.toISOString(),
    endsAt: new Date(
      now.getTime() + (firing ? MAIN_VULN_SCAN_ALERT_TTL_MS : 0),
    ).toISOString(),
    generatorURL: GENERATOR_URL,
  };
}
