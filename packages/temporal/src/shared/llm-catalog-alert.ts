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

/** Everything that decides what this alert can truthfully say. */
export type CatalogSyncOutcome = {
  /** Edits the guards accepted and the script wrote to the catalog. */
  applied: string[];
  /** Edits the guards refused — each needs a human to adjudicate. */
  withheld: string[];
  /**
   * The refresh PR carrying `applied`, once it exists. Must be the real URL of
   * an opened PR, never a prediction that one is about to be opened.
   */
  prUrl: string | undefined;
};

/**
 * Pure builder — no I/O. A withheld edit is never written to the catalog, so
 * nothing downstream of the catalog can reveal it; this alert is what stands
 * between "a provider repriced by 40%" and nobody finding out until a cost
 * report looks wrong.
 *
 * The occurrence is a pure function of the run's own report, which is what
 * keeps the alert honest in BOTH directions: withheld edits fire for the
 * eight-day window, and an empty withheld set builds the resolving occurrence
 * (`endsAt === startsAt`) for the same labels. Deriving the two from one
 * argument is deliberate — a separate resolve builder could drift from these
 * labels, and Alertmanager identifies an alert by its label set alone, so a
 * one-label difference would silently fail to close the firing occurrence and
 * leave remediated drift reported for up to eight days.
 *
 * A run can both apply and withhold edits, so the wording is conditioned on
 * `prUrl` rather than assuming the withheld-only shape. It names a PR only
 * when handed the URL of one that already exists — an alert that predicted a
 * PR would outlive the failure that stopped it being opened and spend eight
 * days pointing at nothing.
 *
 * Labels carry no per-model values: one alert per run, deduped on identity.
 */
export function buildCatalogWithheldAlert(
  outcome: CatalogSyncOutcome,
  now: Date,
): AlertmanagerAlert {
  const { applied, withheld, prUrl } = outcome;
  const resolved = withheld.length === 0;
  const shown = withheld.slice(0, MAX_WITHHELD_LINES);
  const omitted = withheld.length - shown.length;
  const summary = resolved
    ? "LLM catalog refresh withheld nothing — earlier withheld drift is resolved"
    : `LLM catalog refresh withheld ${String(withheld.length)} upstream edit(s)`;
  const description = resolved
    ? [
        "sync-from-upstreams.ts completed with every upstream edit either applied",
        "or in agreement with the catalog. Nothing is awaiting manual adjudication.",
      ].join("\n")
    : [
        `sync-from-upstreams.ts refused ${String(withheld.length)} upstream edit(s) on a plausibility`,
        "guard, so those values are NOT in the catalog. Verify each line against the",
        "provider's own pricing page, then apply it by hand.",
        prUrl === undefined
          ? "This run opened no catalog PR, so these withheld lines are its only outcome."
          : `The other ${String(applied.length)} edit(s) passed the guards and were applied — review those in ${prUrl}, not here.`,
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
