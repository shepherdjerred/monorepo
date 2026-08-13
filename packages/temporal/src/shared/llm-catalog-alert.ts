import type { AlertmanagerAlert } from "#lib/alertmanager.ts";

const SYNC_SCRIPT_URL =
  "https://github.com/shepherdjerred/monorepo/blob/main/packages/llm-models/scripts/sync-from-upstreams.ts";

const MAX_WITHHELD_LINES = 25;

/**
 * How long a withheld-drift alert stays firing without being re-fired. The
 * catalog refresh runs weekly, so a shorter window would let the alert resolve
 * itself between runs and the finding would disappear before anyone looked.
 * That length is only safe because a clean run resolves the alert explicitly —
 * see `buildCatalogWithheldAlert`.
 */
export const LLM_CATALOG_WITHHELD_ALERT_TTL_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * Pure builder — no I/O. A withheld edit produces no catalog diff and no PR,
 * so this alert is the only thing standing between "a provider repriced by
 * 40%" and nobody finding out until a cost report looks wrong.
 *
 * The occurrence is a pure function of the run's withheld set, which is what
 * keeps the alert honest in BOTH directions: a non-empty set fires for the
 * eight-day window, and an empty set builds the resolving occurrence
 * (`endsAt === startsAt`) for the same labels. Deriving the two from one
 * argument is deliberate — a separate resolve builder could drift from these
 * labels, and Alertmanager identifies an alert by its label set alone, so a
 * one-label difference would silently fail to close the firing occurrence and
 * leave remediated drift reported for up to eight days.
 *
 * Labels carry no per-model values: one alert per run, deduped on identity.
 */
export function buildCatalogWithheldAlert(
  withheld: string[],
  now: Date,
): AlertmanagerAlert {
  const resolved = withheld.length === 0;
  const shown = withheld.slice(0, MAX_WITHHELD_LINES);
  const omitted = withheld.length - shown.length;
  const summary = resolved
    ? "LLM catalog refresh withheld nothing — earlier withheld drift is resolved"
    : `LLM catalog refresh withheld ${String(withheld.length)} upstream edit(s) and opened no PR`;
  const description = resolved
    ? [
        "sync-from-upstreams.ts completed with every upstream edit either applied",
        "or in agreement with the catalog. Nothing is awaiting manual adjudication.",
      ].join("\n")
    : [
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
      now.getTime() + (resolved ? 0 : LLM_CATALOG_WITHHELD_ALERT_TTL_MS),
    ).toISOString(),
    generatorURL: SYNC_SCRIPT_URL,
  };
}
