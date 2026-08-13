import type { AlertmanagerAlert } from "#lib/alertmanager.ts";

const SYNC_SCRIPT_URL =
  "https://github.com/shepherdjerred/monorepo/blob/main/packages/llm-models/scripts/sync-from-upstreams.ts";

const MAX_WITHHELD_LINES = 25;

/**
 * How long a withheld-drift alert stays firing without being re-fired. The
 * catalog refresh runs weekly, so a shorter window would let the alert resolve
 * itself between runs and the finding would disappear before anyone looked.
 */
export const LLM_CATALOG_WITHHELD_ALERT_TTL_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * Pure builder — no I/O. A withheld edit produces no catalog diff and no PR,
 * so this alert is the only thing standing between "a provider repriced by
 * 40%" and nobody finding out until a cost report looks wrong. Labels carry no
 * per-model values: one alert per run, deduped on identity alone.
 */
export function buildCatalogWithheldAlert(
  withheld: string[],
  now: Date,
): AlertmanagerAlert {
  const shown = withheld.slice(0, MAX_WITHHELD_LINES);
  const omitted = withheld.length - shown.length;
  const summary = `LLM catalog refresh withheld ${String(withheld.length)} upstream edit(s) and opened no PR`;
  const description = [
    "sync-from-upstreams.ts found upstream drift but every edit failed a",
    "plausibility guard, so the catalog is unchanged and no PR exists to review.",
    "Verify each line against the provider's own pricing page, then apply it by hand.",
    "",
    ...shown,
    ...(omitted > 0 ? [`…and ${String(omitted)} more`] : []),
  ].join("\n");

  return {
    labels: {
      alertname: "LlmCatalogDriftWithheld",
      severity: "warning",
      component: "llm-catalog-refresh",
    },
    // `message` mirrors `description` — the Alerts template reads either
    // depending on the alert source (see xcode-cloud-webhook.ts).
    annotations: { summary, description, message: description },
    startsAt: now.toISOString(),
    endsAt: new Date(
      now.getTime() + LLM_CATALOG_WITHHELD_ALERT_TTL_MS,
    ).toISOString(),
    generatorURL: SYNC_SCRIPT_URL,
  };
}
