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

/** Everything that decides what one model's alert can truthfully say. */
export type CatalogModelOutcome = {
  /** Catalog id this occurrence is about. Its identity, not a description. */
  model: string;
  /** The cross-checked field. Identity bottoms out here — nothing is finer. */
  field: string;
  /** Edits the guards accepted this run, across the catalog. */
  applied: string[];
  /** This model's refused edits. Empty means resolve. */
  withheld: string[];
  /**
   * The refresh PR carrying `applied`, once it exists. Must be the real URL of
   * an opened PR, never a prediction that one is about to be opened.
   */
  prUrl: string | undefined;
};

/** One model's field-by-field verdict, mirroring the sync report. */
export type CatalogModelVerdict = {
  withheld: Record<string, string | undefined>;
  measured: string[];
  unmeasured: string[];
};

/** The run's verdicts, as the sync report records them. */
export type CatalogSyncOutcome = {
  applied: string[];
  models: Record<string, CatalogModelVerdict>;
  prUrl: string | undefined;
};

/**
 * Fires while a field cannot be checked at all, and resolves the moment it can.
 *
 * This is the counterpart that makes per-field silence safe. A drift occurrence
 * is only published for fields the run actually measured, so a field that stops
 * being measurable stops being re-fired and expires on its TTL — which would
 * quietly retire an unadjudicated divergence. Raising the missing-evidence
 * condition in its place keeps the model visible under a claim that is
 * accurate: not "this is fine", but "nobody can currently tell".
 */
export function buildCatalogEvidenceAlert(
  model: string,
  field: string,
  missing: boolean,
  now: Date,
): AlertmanagerAlert {
  const description = missing
    ? [
        `No upstream published a ${field} value for ${model}, so the catalog's`,
        "number cannot be verified this run and its drift alert is not being",
        "refreshed. Check the provider's own pricing page, or remove the model if",
        "it is retired.",
      ].join("\n")
    : `${model}.${field} is measurable again; upstream evidence has returned.`;
  return {
    labels: {
      alertname: "LlmCatalogEvidenceMissing",
      severity: "warning",
      component: "llm-catalog-refresh",
      model,
      field,
    },
    annotations: {
      summary: missing
        ? `LLM catalog: ${model}.${field} has no upstream evidence`
        : `LLM catalog: ${model}.${field} is verifiable again`,
      description,
      message: description,
    },
    startsAt: now.toISOString(),
    endsAt: new Date(
      now.getTime() + (missing ? LLM_CATALOG_WITHHELD_ALERT_TTL_MS : 0),
    ).toISOString(),
    generatorURL: SYNC_SCRIPT_URL,
  };
}

/**
 * One occurrence per measured model — the identity that makes resolution safe.
 *
 * A run may only speak for what it measured. A model missing from both
 * upstreams is not evidence of anything, so it gets no occurrence at all and
 * its previous one stands untouched; crucially it also cannot speak for any
 * OTHER model. Gating on the run-wide unmeasured set instead made one
 * permanently overlay-only flagship — a normal, expected state for a model
 * upstreams have not published yet — block every unrelated resolution until
 * the eight-day TTL expired.
 *
 * Cardinality stays bounded by the catalog's text models (currently 14), and
 * the `model` label is what lets Alertmanager track each divergence separately.
 */
export function buildCatalogAlerts(
  outcome: CatalogSyncOutcome,
  now: Date,
): AlertmanagerAlert[] {
  const alerts: AlertmanagerAlert[] = [];
  for (const [model, verdict] of Object.entries(outcome.models)) {
    for (const field of verdict.measured) {
      const withheld = verdict.withheld[field];
      alerts.push(
        buildCatalogWithheldAlert(
          {
            model,
            field,
            applied: outcome.applied,
            withheld: withheld === undefined ? [] : [withheld],
            prUrl: outcome.prUrl,
          },
          now,
        ),
        buildCatalogEvidenceAlert(model, field, false, now),
      );
    }
    for (const field of verdict.unmeasured) {
      alerts.push(buildCatalogEvidenceAlert(model, field, true, now));
    }
  }
  return alerts;
}

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
 * The `model` label IS the identity: it is what lets one model's divergence
 * resolve without speaking for another's. Cardinality is bounded by the
 * catalog's text models.
 */
export function buildCatalogWithheldAlert(
  outcome: CatalogModelOutcome,
  now: Date,
): AlertmanagerAlert {
  const { model, field, applied, withheld, prUrl } = outcome;
  const resolved = withheld.length === 0;
  // Truncation is a courtesy, allowed only when the full list survives
  // elsewhere: the refresh PR body carries the script's entire report. A
  // withheld-only run has no PR and its JSON report dies with the bot's temp
  // clone, so this alert is the sole record and must carry every line — the
  // fixed ordering would otherwise drop the same tail every week, forever.
  const shown =
    prUrl === undefined ? withheld : withheld.slice(0, MAX_WITHHELD_LINES);
  const omitted = withheld.length - shown.length;
  const summary = resolved
    ? `LLM catalog: ${model}.${field} has no withheld drift — earlier finding is resolved`
    : `LLM catalog: ${model}.${field} has ${String(withheld.length)} withheld upstream edit(s)`;
  const description = resolved
    ? [
        `sync-from-upstreams.ts compared ${model}.${field} against the upstreams and`,
        "found it either applied or already in agreement. Nothing about this field",
        "is awaiting manual adjudication.",
      ].join("\n")
    : [
        `sync-from-upstreams.ts refused ${String(withheld.length)} upstream edit(s) for ${model}.${field} on a`,
        "guard, so the catalog still holds its current values. Check each line against",
        "the provider's own pricing page and decide: apply the upstream value, or",
        "confirm the catalog's value is the intended one. Both are real outcomes — a",
        "divergence can be deliberate, such as a standard rate held while upstream",
        "lists a temporary promotional one.",
        "To make a retain decision stick, record the upstream number under the",
        "entry's `acceptedUpstreamPricing` in catalog.json. That stops this alert",
        "for that value only — a later repricing to a different number reopens it.",
        prUrl === undefined
          ? "This run opened no catalog PR, so these withheld lines are its only outcome."
          : `The other ${String(applied.length)} edit(s) passed the guards and were applied — review those in ${prUrl}, not here.`,
        "",
        ...shown,
        ...(omitted > 0
          ? [`…and ${String(omitted)} more — the full list is in the PR body.`]
          : []),
      ].join("\n");

  return {
    labels: {
      alertname: "LlmCatalogDriftWithheld",
      severity: "warning",
      component: "llm-catalog-refresh",
      model,
      field,
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
