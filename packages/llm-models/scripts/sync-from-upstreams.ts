#!/usr/bin/env bun
/**
 * Cross-check the catalog against community datasets and report/apply drift.
 *
 * Source of truth is still our own `src/catalog.json`. This script fetches two
 * public, MIT-licensed datasets — models.dev and LiteLLM's
 * `model_prices_and_context_window.json` — and, for each TEXT model WE list,
 * compares the unambiguous fields (input price, output price, context window).
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
 * `claude-sonnet-5` holds the standard $3/$15 while upstreams list the
 * introductory $2/$10, so the guard fires every week on a divergence that is
 * working as intended. Anything that tells an operator to apply the upstream
 * value unconditionally is wrong. It must never be reduced to stdout,
 * though: a run that withholds everything writes no catalog diff, so the
 * unattended caller would otherwise see a clean no-op and a real repricing
 * would sit unreviewed forever. `--report-json` gives that caller a typed
 * signal to act on, and `--check` exits non-zero on withheld edits as well as
 * on drift.
 *
 * Deliberately NOT cross-checked:
 *   - cache prices: providers name them differently (OpenAI cached-input vs
 *     Anthropic cache read/write) and upstreams normalize inconsistently.
 *   - image models: upstreams price them per token; we price per image.
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

const MODELS_DEV_URL = "https://models.dev/api.json";
const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CATALOG_PATH = new URL("../src/catalog.json", import.meta.url);
const EPSILON = 1e-9;

const UnknownRecord = z.record(z.string(), z.unknown());

/** Per-1M-token input/output (+ context) — the fields we cross-check. */
export type Upstream = {
  input?: number | undefined;
  output?: number | undefined;
  contextWindow?: number | undefined;
};

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function record(value: unknown): Record<string, unknown> {
  const parsed = UnknownRecord.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function perMillion(value: unknown): number | undefined {
  const n = num(value);
  return n === undefined ? undefined : n * 1_000_000;
}

function emit(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Both upstreams are keyed by a bare model id that MANY vendors publish under.
 * `anthropic`, `openrouter`, and ~200 resellers all list `claude-opus-5`, each
 * at their own price. Flattening those into one id-keyed map means whichever
 * vendor the source happens to iterate last silently wins — which is exactly
 * how PR #2102 rewrote the catalog from `cortecs`, `xpersona`, and `jiekou`
 * markups (Haiku's context window cut 200000 -> 20000, Fable 5 repriced
 * $10/$50 -> $3/$18.50) while our committed values matched `anthropic` and
 * `openai` exactly.
 *
 * So every index is keyed `provider:id`, and lookup uses the catalog entry's
 * OWN declared provider. A price we cannot attribute to the vendor we actually
 * buy from is not evidence about anything.
 */
export function providerKey(provider: string, id: string): string {
  return `${provider}:${id}`;
}

/** models.dev: { provider: { models: { id: { cost:{input,output}, limit:{context} } } } } — already per-1M. */
export function indexModelsDev(raw: unknown): Map<string, Upstream> {
  const out = new Map<string, Upstream>();
  for (const [providerId, provider] of Object.entries(record(raw))) {
    for (const [id, modelRaw] of Object.entries(
      record(record(provider)["models"]),
    )) {
      const model = record(modelRaw);
      const cost = record(model["cost"]);
      out.set(providerKey(providerId, id), {
        input: num(cost["input"]),
        output: num(cost["output"]),
        contextWindow: num(record(model["limit"])["context"]),
      });
    }
  }
  return out;
}

/**
 * LiteLLM key prefixes we accept, mapped onto our provider ids.
 *
 * Deliberately only the three DIRECT APIs we actually buy from. A key like
 * `bedrock/anthropic.claude-opus-5`, `azure/gpt-5.5`, or `vertex_ai/gemini-x`
 * is a different vendor selling the same weights at its own price — exactly the
 * category of evidence that poisoned the catalog in #2102. Those are skipped,
 * so the model falls through to "overlay-only" and gets reported for manual
 * review rather than silently adopting a gateway's markup.
 *
 * This also replaces the old alias-stripping, which chopped every `/` and `.`
 * prefix and indexed the bare remainder first-wins — letting a Bedrock or
 * Vertex row bind to one of our clean ids non-deterministically.
 */
const LITELLM_VENDOR_TO_PROVIDER = new Map<string, string>([
  ["openai", "openai"],
  ["anthropic", "anthropic"],
  ["gemini", "google"],
]);

/**
 * LiteLLM: top-level { id: { litellm_provider, *_cost_per_token, max_input_tokens } } — per-TOKEN.
 *
 * Attribution comes from each row's `litellm_provider`, never from the key's
 * shape. The direct-API rows we actually buy from are overwhelmingly keyed
 * BARE — `claude-opus-5`, `gpt-5.5` — and only gateway resales carry a
 * `vendor/` prefix, so requiring a slash would drop exactly the rows this
 * fallback exists to read while keeping none of the ones it must reject.
 * A prefix is stripped only when it is the row's own declared vendor, leaving
 * the model id verbatim (`openai/gpt-5.5` -> `gpt-5.5`, dots intact).
 */
export function indexLiteLlm(raw: unknown): Map<string, Upstream> {
  const out = new Map<string, Upstream>();
  for (const [key, modelRaw] of Object.entries(record(raw))) {
    const model = record(modelRaw);
    const vendor = model["litellm_provider"];
    if (typeof vendor !== "string") {
      continue;
    }
    const provider = LITELLM_VENDOR_TO_PROVIDER.get(vendor);
    if (provider === undefined) {
      continue;
    }
    const prefix = `${vendor}/`;
    const id = key.startsWith(prefix) ? key.slice(prefix.length) : key;
    const mapKey = providerKey(provider, id);
    if (out.has(mapKey)) {
      continue;
    }
    out.set(mapKey, {
      input: perMillion(model["input_cost_per_token"]),
      output: perMillion(model["output_cost_per_token"]),
      contextWindow: num(model["max_input_tokens"]),
    });
  }
  return out;
}

/**
 * Refuse to treat a failed cross-check as a clean one.
 *
 * `record()` turns any unexpected body into `{}`, so a 200 carrying an empty
 * or reshaped payload builds empty indexes, every model falls through to
 * overlay-only, and the report comes back with nothing applied and nothing
 * withheld. That is byte-identical to a genuinely clean run — which means the
 * unattended caller would resolve a real, still-open drift alert on the
 * strength of a comparison that never happened. A degraded fetch must fail the
 * run instead, so the alert simply stays as it was.
 *
 * What must hold is coverage, not that both fetches succeeded. Coverage is
 * therefore checked across the union: LiteLLM is only a fallback, so models.dev
 * alone is still evidence, and either source going empty on a transient payload
 * or shape change must not abort a run the other source can still substantiate.
 * A field no surviving source publishes is not silently treated as agreeing —
 * it is reported as unmeasured, which is what `verdictFor` exists to say.
 *
 * Both sources going empty is the one case with no evidence at all behind it.
 * The coverage loop below would catch it whenever the catalog ships a provider,
 * but only by naming every provider at once; failing here says what actually
 * happened, and still holds for a catalog that ships none.
 */
export function assertUpstreamCoverage(
  modelsDev: Map<string, Upstream>,
  liteLlm: Map<string, Upstream>,
  providers: ReadonlySet<string>,
): void {
  if (modelsDev.size === 0 && liteLlm.size === 0) {
    throw new Error(
      "no upstream returned usable models; refusing to report an empty cross-check as clean",
    );
  }
  const covered = (provider: string): boolean =>
    [...modelsDev.keys(), ...liteLlm.keys()].some((key) =>
      key.startsWith(`${provider}:`),
    );
  const missing = [...providers].filter((provider) => !covered(provider));
  if (missing.length > 0) {
    throw new Error(
      `no upstream covered any model for: ${missing.join(", ")}; refusing to report an incomplete cross-check as clean`,
    );
  }
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

/**
 * The three values we cross-check. This is the comparison atom — reconcile has
 * exactly one block per field and nothing finer exists, which is why alert
 * identity bottoms out at (model, field).
 */
export type CrossCheckField = "input" | "output" | "contextWindow";

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
/** Which upstream supplied the values, and the clock acceptance expiry is judged against. */
export type ReconcileContext = {
  source: string;
  now: Date;
};

export function reconcile(
  id: string,
  entry: ModelEntry,
  upstream: Upstream,
  { source, now }: ReconcileContext,
): ReconcileResult {
  if (entry.pricing.modality !== "text") {
    return { applied: [], rejectedByField: {}, rejected: [] };
  }
  const applied: string[] = [];
  const rejectedByField: Partial<Record<CrossCheckField, string>> = {};
  const note = (
    field: CrossCheckField,
    before: number,
    after: number,
  ): void => {
    applied.push(
      `  ${id}.${field}: ${String(before)} -> ${String(after)} (${source})`,
    );
  };
  const reject = (field: CrossCheckField, reason: string): void => {
    rejectedByField[field] = `  ${id}.${field}: ${reason} (${source})`;
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

  if (
    upstream.input !== undefined &&
    !accepted("input", upstream.input, entry.pricing.input) &&
    Math.abs(entry.pricing.input - upstream.input) > EPSILON
  ) {
    const decision = priceDecision(entry.pricing.input, upstream.input);
    if (decision.kind === "apply") {
      note("input", entry.pricing.input, decision.value);
      entry.pricing.input = decision.value;
    } else {
      reject("input", decision.reason);
    }
  }
  if (
    upstream.output !== undefined &&
    !accepted("output", upstream.output, entry.pricing.output) &&
    Math.abs(entry.pricing.output - upstream.output) > EPSILON
  ) {
    const decision = priceDecision(entry.pricing.output, upstream.output);
    if (decision.kind === "apply") {
      note("output", entry.pricing.output, decision.value);
      entry.pricing.output = decision.value;
    } else {
      reject("output", decision.reason);
    }
  }
  if (
    upstream.contextWindow !== undefined &&
    entry.contextWindow !== undefined &&
    entry.contextWindow !== upstream.contextWindow &&
    entry.pinnedContextWindow !== true
  ) {
    const reason = contextRejection(
      entry.contextWindow,
      upstream.contextWindow,
    );
    if (reason === undefined) {
      note("contextWindow", entry.contextWindow, upstream.contextWindow);
      entry.contextWindow = upstream.contextWindow;
    } else {
      reject("contextWindow", reason);
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
  const fields: CrossCheckField[] = ["input", "output"];
  if (entry.contextWindow !== undefined && entry.pinnedContextWindow !== true) {
    fields.push("contextWindow");
  }
  return fields;
}

/** What this run can honestly say about one model, field by field. */
export type ModelVerdict = {
  /** Withheld reason per field — needs a human. */
  withheld: Partial<Record<CrossCheckField, string>>;
  /** Fields an upstream actually supplied a value for. */
  measured: CrossCheckField[];
  /** Applicable fields no upstream covered — no evidence either way. */
  unmeasured: CrossCheckField[];
};

export function verdictFor(
  entry: ModelEntry,
  upstream: Upstream | undefined,
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

function emitReport(report: SyncReport, check: boolean): void {
  emit("== LLM catalog cross-check ==");
  emit(
    report.applied.length > 0
      ? `\nDrift vs upstreams (${check ? "not applied" : "applied"}):\n${report.applied.join("\n")}`
      : "\nNo input/output/context drift vs upstreams.",
  );
  if (report.withheld.length > 0) {
    emit(
      `\nWITHHELD by plausibility guards — check each against the provider's own pricing page, then either apply the upstream value or confirm the catalog's is intended (a divergence can be deliberate, e.g. a standard rate held while upstream lists a promotional one):\n${report.withheld.join("\n")}`,
    );
  }
  if (report.overlayOnly.length > 0) {
    emit(
      `\nOverlay-only (absent from both upstreams under their own provider — verify manually):\n  ${report.overlayOnly.join("\n  ")}`,
    );
  }
  if (report.notChecked.length > 0) {
    emit(`\nNot cross-checked:\n  ${report.notChecked.join("\n  ")}`);
  }
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
  assertUpstreamCoverage(
    modelsDev,
    liteLlm,
    new Set(
      Object.values(catalog)
        .filter((entry) => entry.pricing.modality === "text")
        .map((entry) => entry.provider),
    ),
  );

  const now = new Date();
  const drifted: string[] = [];
  const models: Record<string, ModelVerdict> = {};
  const overlayOnly: string[] = [];
  const notChecked: string[] = [];

  for (const [id, entry] of Object.entries(catalog)) {
    if (entry.pricing.modality !== "text") {
      notChecked.push(`${id} (image — per-image pricing not in upstreams)`);
      continue;
    }
    // Look the model up under ITS OWN provider. A `claude-opus-5` price from
    // some reseller is not evidence about what Anthropic charges us.
    const key = providerKey(entry.provider, id);
    const fromModelsDev = modelsDev.get(key);
    const upstream = fromModelsDev ?? liteLlm.get(key);
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
    const result = reconcile(id, entry, upstream, {
      source: fromModelsDev === undefined ? "litellm" : "models.dev",
      now,
    });
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

  if (!check && drifted.length > 0) {
    // Patch only the drifted numeric fields into the raw JSON structure so that
    // key ordering and other non-numeric fields are preserved exactly as-is.
    for (const [id, entry] of Object.entries(catalog)) {
      if (entry.pricing.modality !== "text" || rawCatalog[id] === undefined) {
        continue;
      }
      const rawEntry = record(rawCatalog[id]);
      const rawPricing = record(rawEntry["pricing"]);
      rawPricing["input"] = entry.pricing.input;
      rawPricing["output"] = entry.pricing.output;
      if (entry.contextWindow !== undefined) {
        rawEntry["contextWindow"] = entry.contextWindow;
      }
      rawEntry["pricing"] = rawPricing;
      rawCatalog[id] = rawEntry;
    }
    await Bun.write(CATALOG_PATH, `${JSON.stringify(rawCatalog, null, 2)}\n`);
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
