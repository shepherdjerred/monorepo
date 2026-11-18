#!/usr/bin/env bun
/**
 * Cross-check the catalog against community datasets and report/apply drift.
 *
 * Source of truth is still our own `src/catalog.json`. This script fetches the
 * public models.dev and LiteLLM datasets for pricing/context drift, and checks
 * that every routable model still declares a native provider route. For
 * each text model we list, it compares the unambiguous numeric fields.
 * It:
 *   - rewrites our values to the upstream value when they drift (default), and
 *   - reports models absent from BOTH upstreams as "overlay-only" (e.g.
 *     brand-new flagships) — those stay manually maintained.
 *
 * Two safeguards exist because this script writes the catalog unattended and a
 * bad write reaches every cost calculation in the repo. Both were added after
 * PR #2102, where an unattended run repriced most of the catalog from random
 * resellers and went red across three packages:
 *   1. Every upstream is indexed `provider:id` and looked up under the catalog
 *      entry's OWN provider. See `providerKey`.
 *   2. Implausible edits are withheld and reported rather than applied. See
 *      `priceRejection` / `contextRejection`.
 * A withheld edit is not a failure, and it is not a correction waiting to be
 * applied either — it is the script saying a human should read the provider's
 * own pricing page and decide. The catalog value can be the deliberate one:
 * for example, holding a standard rate while upstream lists a promotional one,
 * where the guard fires on a divergence that is working as intended. Anything
 * that tells an operator to apply the upstream value unconditionally is wrong.
 * It must never be reduced to stdout, though: a run that withholds everything
 * writes no catalog diff, so the unattended caller would otherwise see a clean
 * no-op and a real repricing would sit unreviewed forever. `--report-json` gives
 * that caller a typed signal to act on, and `--check` exits non-zero on
 * withheld edits as well as on drift.
 *
 * Deliberately NOT cross-checked:
 *   - cache prices: providers name them differently (OpenAI cached-input vs
 *     Anthropic cache read/write) and upstreams normalize inconsistently.
 *   - image pricing: upstreams price it per token; we price per image.
 * Both are reported as "not cross-checked" so a human can spot-check them.
 *
 * Never adds/removes models; never touches non-numeric fields.
 *
 * Usage:
 *   bun run scripts/sync-from-upstreams.ts                       # apply drift, write catalog.json
 *   bun run scripts/sync-from-upstreams.ts --check               # report only, non-zero exit on drift or withheld edits
 *   bun run scripts/sync-from-upstreams.ts --report-json <path>  # also write the machine-readable report
 */
import { z } from "zod";
import { CatalogSchema, type Catalog, type ModelEntry } from "#src/index.ts";
import { emit, emitReport } from "#scripts/report.ts";
import {
  assertUpstreamCoverage,
  crossCheckedProviders,
  indexLiteLlm,
  indexModelsDev,
  mergeUpstreams,
  providerKey,
  type CrossCheckField,
  type MeasuredField,
  type MergedUpstream,
} from "#scripts/upstreams.ts";

/**
 * Report a model that should be callable but declares no native route.
 *
 * Deprecated entries keep their prices for historical attribution and are
 * allowed to lose their route; a `current` or `preview` entry without one is a
 * model application code can ask for and the runtime will refuse, so it fails
 * the sync rather than waiting to throw in production. A `pricingOnly` entry
 * is never callable, so it has no route by contract.
 *
 * This is a catalog invariant, not an upstream reachability probe: confirming a
 * model is still served would mean authenticating to all three providers from
 * an unattended weekly job. Pricing drift already covers the "quietly changed"
 * case for text models, and a withdrawn model shows up as overlay-only.
 */
export function missingNativeRoute(
  id: string,
  entry: ModelEntry,
): string | undefined {
  return entry.pricingOnly === true ||
    entry.status === "deprecated" ||
    entry.routes.native !== undefined
    ? undefined
    : `${id} (${entry.status}) has no native route`;
}

const MODELS_DEV_URL = "https://models.dev/api.json";
const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CATALOG_PATH = new URL("../src/catalog.json", import.meta.url);
const EPSILON = 1e-9;

const UnknownRecord = z.record(z.string(), z.unknown());

function record(value: unknown): Record<string, unknown> {
  const parsed = UnknownRecord.safeParse(value);
  return parsed.success ? parsed.data : {};
}

/**
 * Reject an upstream value that is implausible as a real published price.
 *
 * Provider scoping fixes attribution; this catches the rest — a vendor typo, a
 * currency-converted or marked-up figure, or a genuine repricing large enough
 * that a human should look. Returns a reason when the edit must NOT be applied.
 */
const MAX_PRICE_CHANGE_RATIO = 0.25;
const MAX_PRICE_DECIMALS = 2;
/**
 * Slack for binary-float artifacts. `perMillion` multiplies LiteLLM's
 * per-token figures by 1e6, so a real $0.20/M list price arrives as
 * 0.19999999999999998. Counting the digits of that string called a legitimate
 * price a 17-decimal reseller markup and withheld it forever; a value is
 * "round" if it sits this close to its 2-decimal rounding.
 */
const PRICE_ROUNDING_TOLERANCE = 1e-9;

/** Either the value to write (normalized) or the reason to withhold it. */
export type PriceDecision =
  | { readonly kind: "apply"; readonly value: number }
  | { readonly kind: "withhold"; readonly reason: string };

export function priceDecision(before: number, after: number): PriceDecision {
  // Published list prices are round. 32.998 / 4.982 / 0.996 are arithmetic
  // artifacts of a reseller's markup, and were a reliable tell in #2102.
  const scale = 10 ** MAX_PRICE_DECIMALS;
  const value = Math.round(after * scale) / scale;
  if (Math.abs(after - value) > PRICE_ROUNDING_TOLERANCE) {
    return {
      kind: "withhold",
      reason: `${String(after)} is not a round list price (max ${String(MAX_PRICE_DECIMALS)} decimal places)`,
    };
  }
  if (before === 0) {
    return value === 0
      ? { kind: "apply", value }
      : { kind: "withhold", reason: `${String(value)} replaces a zero price` };
  }
  const ratio = Math.abs(value - before) / before;
  if (ratio > MAX_PRICE_CHANGE_RATIO) {
    return {
      kind: "withhold",
      reason: `${String(before)} -> ${String(value)} is a ${String(Math.round(ratio * 100))}% change (max ${String(MAX_PRICE_CHANGE_RATIO * 100)}%)`,
    };
  }
  return { kind: "apply", value };
}

export function contextRejection(
  before: number,
  after: number,
): string | undefined {
  // A model's context window does not shrink. Haiku 4.5's 200000 -> 20000 in
  // #2102 came from a reseller listing a truncated deployment.
  return after < before
    ? `${String(before)} -> ${String(after)} shrinks the context window`
    : undefined;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `fetch ${url} failed: ${String(res.status)} ${res.statusText}`,
    );
  }
  return res.json();
}

export type ReconcileResult = {
  /** Edits applied to `entry`. */
  applied: string[];
  /**
   * Withheld reason per field. Keyed rather than flat because a run may only
   * speak for the fields it actually compared, and the alert is raised per
   * field for the same reason.
   */
  rejectedByField: Partial<Record<CrossCheckField, string>>;
  /** The withheld reasons, flattened — the human-readable view. */
  rejected: string[];
};

/** Mutates `entry` to match upstream input/output/context, subject to the guards. */
/** The clock the acceptance expiry is judged against. */
export type ReconcileContext = {
  now: Date;
};

export function reconcile(
  id: string,
  entry: ModelEntry,
  upstream: MergedUpstream,
  { now }: ReconcileContext,
): ReconcileResult {
  if (entry.pricing.modality !== "text") {
    return { applied: [], rejectedByField: {}, rejected: [] };
  }
  const applied: string[] = [];
  const rejectedByField: Partial<Record<CrossCheckField, string>> = {};
  const note = (
    measured: MeasuredField,
    field: CrossCheckField,
    before: number,
    after: number,
  ): void => {
    applied.push(
      `  ${id}.${field}: ${String(before)} -> ${String(after)} (${measured.source})`,
    );
  };
  const reject = (
    measured: MeasuredField,
    field: CrossCheckField,
    reason: string,
  ): void => {
    rejectedByField[field] = `  ${id}.${field}: ${reason} (${measured.source})`;
  };

  /**
   * True when a human already looked at exactly this upstream number and kept
   * the catalog's. Matching on the value, not just the field, is deliberate: an
   * accepted $2 does not accept a later $4, so a real repricing still surfaces.
   */
  const recorded = entry.acceptedUpstreamPricing;
  // An acceptance is a decision with a shelf life. Past its expiry the
  // divergence is reported again, which is the only thing that forces a human
  // to look at whether the reason still holds.
  const acceptance =
    recorded !== undefined && now < new Date(recorded.expiresAt)
      ? recorded
      : undefined;
  const accepted = (
    field: "input" | "output",
    upstreamValue: number,
    catalogValue: number,
  ): boolean => {
    const acknowledged = acceptance?.[field];
    return (
      acknowledged !== undefined &&
      Math.abs(acknowledged.upstream - upstreamValue) <= EPSILON &&
      // The catalog half matters as much as the upstream half. Without it, an
      // intermediate plausible price applies, upstream swings back to the
      // accepted number, and this would suppress a value nobody adjudicated.
      Math.abs(acknowledged.catalog - catalogValue) <= EPSILON
    );
  };

  const inputField = upstream.input;
  if (
    inputField !== undefined &&
    !accepted("input", inputField.value, entry.pricing.input) &&
    Math.abs(entry.pricing.input - inputField.value) > EPSILON
  ) {
    const decision = priceDecision(entry.pricing.input, inputField.value);
    if (decision.kind === "apply") {
      note(inputField, "input", entry.pricing.input, decision.value);
      entry.pricing.input = decision.value;
    } else {
      reject(inputField, "input", decision.reason);
    }
  }
  const outputField = upstream.output;
  if (
    outputField !== undefined &&
    !accepted("output", outputField.value, entry.pricing.output) &&
    Math.abs(entry.pricing.output - outputField.value) > EPSILON
  ) {
    const decision = priceDecision(entry.pricing.output, outputField.value);
    if (decision.kind === "apply") {
      note(outputField, "output", entry.pricing.output, decision.value);
      entry.pricing.output = decision.value;
    } else {
      reject(outputField, "output", decision.reason);
    }
  }
  const contextField = upstream.contextWindow;
  if (
    contextField !== undefined &&
    entry.contextWindow !== undefined &&
    entry.contextWindow !== contextField.value &&
    entry.pinnedContextWindow !== true
  ) {
    const reason = contextRejection(entry.contextWindow, contextField.value);
    if (reason === undefined) {
      note(
        contextField,
        "contextWindow",
        entry.contextWindow,
        contextField.value,
      );
      entry.contextWindow = contextField.value;
    } else {
      reject(contextField, "contextWindow", reason);
    }
  }
  return {
    applied,
    rejectedByField,
    rejected: Object.values(rejectedByField),
  };
}

/**
 * Which fields this entry is eligible to have cross-checked at all. Anything
 * outside this set is not "unmeasured" — it is simply not our business, so it
 * must never produce a missing-evidence signal.
 */
function applicableFields(entry: ModelEntry): CrossCheckField[] {
  if (entry.pricing.modality !== "text") {
    return [];
  }
  // Embeddings emit no output tokens, so `output` is not a billing dimension
  // for them — `text-embedding-3-small` carries a placeholder 0. Treating it as
  // checkable made an upstream that CORRECTLY omits the price look like missing
  // evidence, and fired a finding about a number that does not exist.
  //
  // Keyed on the category rather than `output === 0` deliberately: the category
  // states why there is no dimension, while a zero price is a consequence that
  // a genuinely free model would also produce. Both identify the same single
  // row today; only one stays right if a promotional free price appears.
  //
  // This is a stopgap. It is the fourth model class this function has had to
  // special-case, and the real fix is for entries to declare which fields
  // upstream owns instead of having this infer it.
  const fields: CrossCheckField[] =
    entry.category === "embedding" ? ["input"] : ["input", "output"];
  if (entry.contextWindow !== undefined && entry.pinnedContextWindow !== true) {
    fields.push("contextWindow");
  }
  return fields;
}

/**
 * Fields this entry carries but has taken out of cross-checking on purpose.
 *
 * A model with no `contextWindow` at all is not our business and produces
 * nothing. One that has a context window and pins it is a decision, and a
 * decision has to close the alert that prompted it.
 */
function retiredFields(entry: ModelEntry): CrossCheckField[] {
  return entry.pricing.modality === "text" &&
    entry.contextWindow !== undefined &&
    entry.pinnedContextWindow === true
    ? ["contextWindow"]
    : [];
}

/** What this run can honestly say about one model, field by field. */
export type ModelVerdict = {
  /** Withheld reason per field — needs a human. */
  withheld: Partial<Record<CrossCheckField, string>>;
  /** Fields an upstream actually supplied a value for. */
  measured: CrossCheckField[];
  /** Applicable fields no upstream covered — no evidence either way. */
  unmeasured: CrossCheckField[];
  /**
   * Fields the entry has deliberately retired from cross-checking.
   *
   * Distinct from "not applicable": a pinned context window is a field we WERE
   * checking and a human has since adjudicated, so it is exactly the case that
   * must publish a resolution. Omitting it left the drift alert the operator
   * was responding to firing until its TTL — the alert told them to pin the
   * field, and pinning it appeared to do nothing.
   */
  retired: CrossCheckField[];
};

export function verdictFor(
  entry: ModelEntry,
  upstream: MergedUpstream | undefined,
  result: ReconcileResult,
): ModelVerdict {
  const applicable = applicableFields(entry);
  const measured = applicable.filter(
    (field) => upstream?.[field] !== undefined,
  );
  return {
    withheld: result.rejectedByField,
    measured,
    unmeasured: applicable.filter((field) => !measured.includes(field)),
    retired: retiredFields(entry),
  };
}

/**
 * The stdout report, structured, for an unattended caller. `withheld` is the
 * field that matters: it is the only outcome that needs a human and produces
 * no catalog diff to notice.
 */
export type SyncReport = {
  applied: string[];
  /** Every withheld line, flattened — the human-readable view. */
  withheld: string[];
  /**
   * Per-model, per-field verdicts. Identity has to survive the report because
   * the alert is raised per (model, field): a run may only speak for the exact
   * fields it compared, and nothing coarser is honest.
   */
  models: Record<string, ModelVerdict>;
  overlayOnly: string[];
  notChecked: string[];
};

/**
 * Patch only the drifted numeric fields into the raw JSON structure so that key
 * ordering and non-numeric fields (including multi-endpoint native routes such
 * as `gpt-6-luna`'s `["language", "decisions"]`) are preserved verbatim.
 */
export function patchRawCatalog(
  rawCatalog: Record<string, unknown>,
  catalog: Catalog,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...rawCatalog };
  for (const [id, entry] of Object.entries(catalog)) {
    if (entry.pricing.modality !== "text" || next[id] === undefined) {
      continue;
    }
    const rawEntry = record(next[id]);
    const rawPricing = record(rawEntry["pricing"]);
    rawPricing["input"] = entry.pricing.input;
    rawPricing["output"] = entry.pricing.output;
    if (entry.contextWindow !== undefined) {
      rawEntry["contextWindow"] = entry.contextWindow;
    }
    rawEntry["pricing"] = rawPricing;
    next[id] = rawEntry;
  }
  return next;
}

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a path argument`);
  }
  return value;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const reportJsonPath = flagValue("--report-json");

  // Read the raw JSON text first so we can write it back without key reordering.
  // Zod's parse creates a new object with keys in schema-definition order; writing
  // the Zod-parsed output causes spurious diff churn on every refresh run.
  const rawText = await Bun.file(CATALOG_PATH).text();
  const rawCatalog = UnknownRecord.parse(JSON.parse(rawText));
  const catalog: Catalog = CatalogSchema.parse(JSON.parse(rawText));
  const [modelsDevRaw, liteLlmRaw] = await Promise.all([
    fetchJson(MODELS_DEV_URL),
    fetchJson(LITELLM_URL),
  ]);
  const modelsDev = indexModelsDev(modelsDevRaw);
  const liteLlm = indexLiteLlm(liteLlmRaw);
  assertUpstreamCoverage(modelsDev, liteLlm, crossCheckedProviders(catalog));
  const now = new Date();
  const drifted: string[] = [];
  const models: Record<string, ModelVerdict> = {};
  const overlayOnly: string[] = [];
  const notChecked: string[] = [];
  const missingNativeRoutes: string[] = [];

  for (const [id, entry] of Object.entries(catalog)) {
    const missingRoute = missingNativeRoute(id, entry);
    if (missingRoute !== undefined) {
      missingNativeRoutes.push(missingRoute);
    }
    if (entry.pricing.modality !== "text") {
      notChecked.push(`${id} (image — per-image pricing not in upstreams)`);
      continue;
    }
    // Look the model up under ITS OWN provider. A `claude-opus-5` price from
    // some reseller is not evidence about what Anthropic charges us.
    const key = providerKey(entry.provider, id);
    const upstream = mergeUpstreams(modelsDev.get(key), liteLlm.get(key));
    if (upstream === undefined) {
      overlayOnly.push(id);
      // Still a verdict: every applicable field is unmeasured, which is what
      // keeps a vanished model visible instead of silently dropping out.
      models[id] = verdictFor(entry, undefined, {
        applied: [],
        rejectedByField: {},
        rejected: [],
      });
      continue;
    }
    const result = reconcile(id, entry, upstream, { now });
    drifted.push(...result.applied);
    // Measurement is per FIELD, not per model. `Upstream` fields are each
    // optional, so a row carrying `cost.input` but not `cost.output` proves
    // nothing about output — marking the whole model measured would let a
    // resolution close an output alert on evidence that was never fetched.
    models[id] = verdictFor(entry, upstream, result);
  }

  const report: SyncReport = {
    applied: drifted,
    // One source of truth: the flat list is the per-model map read end to end,
    // so the human report and the per-model alerts can never disagree.
    withheld: Object.values(models).flatMap((verdict) =>
      Object.values(verdict.withheld),
    ),
    models,
    overlayOnly,
    notChecked,
  };
  emitReport(report, check);

  if (missingNativeRoutes.length > 0) {
    emit(
      `\nMissing native provider routes:\n  ${missingNativeRoutes.join("\n  ")}`,
    );
    process.exitCode = 1;
  } else {
    emit("\nAll current and preview models declare a native route.");
  }

  if (!check && drifted.length > 0) {
    const patched = patchRawCatalog(rawCatalog, catalog);
    await Bun.write(CATALOG_PATH, `${JSON.stringify(patched, null, 2)}\n`);
    emit("\nWrote updated src/catalog.json.");
  }
  if (reportJsonPath !== undefined) {
    await Bun.write(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  // Withheld edits count in `--check` too: a run that withholds every edit
  // leaves the catalog clean, so drift alone would exit 0 on the one outcome
  // that actually needs a human.
  if (check && (report.applied.length > 0 || report.withheld.length > 0)) {
    process.exitCode = 1;
  }
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  }
}

// Only run the CLI when this file IS the entrypoint. Without the guard,
// importing it to unit-test the pure indexers/guards would fire the live
// models.dev and LiteLLM fetches and rewrite catalog.json.
if (import.meta.main) {
  void run();
}
