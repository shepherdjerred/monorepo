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
 * A withheld edit is not a failure — it is the script saying a human should
 * read the provider's own pricing page.
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
 *   bun run scripts/sync-from-upstreams.ts            # apply drift, write catalog.json
 *   bun run scripts/sync-from-upstreams.ts --check    # report only, non-zero exit on drift
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
type Upstream = {
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

/** LiteLLM: top-level { id: { *_cost_per_token, max_input_tokens } } — per-TOKEN. */
export function indexLiteLlm(raw: unknown): Map<string, Upstream> {
  const out = new Map<string, Upstream>();
  for (const [key, modelRaw] of Object.entries(record(raw))) {
    const slash = key.indexOf("/");
    if (slash === -1) {
      continue;
    }
    const provider = LITELLM_VENDOR_TO_PROVIDER.get(key.slice(0, slash));
    if (provider === undefined) {
      continue;
    }
    // The remainder is the model id verbatim — dots in it belong to the id
    // (`openai/gpt-5.5`), never to a vendor, because a vendor-prefixed
    // remainder only occurs under gateway keys we already skipped above.
    const mapKey = providerKey(provider, key.slice(slash + 1));
    if (out.has(mapKey)) {
      continue;
    }
    const model = record(modelRaw);
    out.set(mapKey, {
      input: perMillion(model["input_cost_per_token"]),
      output: perMillion(model["output_cost_per_token"]),
      contextWindow: num(model["max_input_tokens"]),
    });
  }
  return out;
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

export function priceRejection(
  before: number,
  after: number,
): string | undefined {
  // Published list prices are round. 32.998 / 4.982 / 0.996 are arithmetic
  // artifacts of a reseller's markup, and were a reliable tell in #2102.
  const decimals = (after.toString().split(".")[1] ?? "").length;
  if (decimals > MAX_PRICE_DECIMALS) {
    return `${String(after)} has ${String(decimals)} decimal places (max ${String(MAX_PRICE_DECIMALS)})`;
  }
  if (before === 0) {
    return after === 0 ? undefined : `${String(after)} replaces a zero price`;
  }
  const ratio = Math.abs(after - before) / before;
  if (ratio > MAX_PRICE_CHANGE_RATIO) {
    return `${String(before)} -> ${String(after)} is a ${String(Math.round(ratio * 100))}% change (max ${String(MAX_PRICE_CHANGE_RATIO * 100)}%)`;
  }
  return undefined;
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
  /** Edits withheld by a plausibility guard, for a human to adjudicate. */
  rejected: string[];
};

/** Mutates `entry` to match upstream input/output/context, subject to the guards. */
export function reconcile(
  id: string,
  entry: ModelEntry,
  upstream: Upstream,
  source: string,
): ReconcileResult {
  if (entry.pricing.modality !== "text") {
    return { applied: [], rejected: [] };
  }
  const applied: string[] = [];
  const rejected: string[] = [];
  const note = (field: string, before: number, after: number): void => {
    applied.push(
      `  ${id}.${field}: ${String(before)} -> ${String(after)} (${source})`,
    );
  };
  const reject = (field: string, reason: string): void => {
    rejected.push(`  ${id}.${field}: ${reason} (${source})`);
  };

  if (
    upstream.input !== undefined &&
    Math.abs(entry.pricing.input - upstream.input) > EPSILON
  ) {
    const reason = priceRejection(entry.pricing.input, upstream.input);
    if (reason === undefined) {
      note("input", entry.pricing.input, upstream.input);
      entry.pricing.input = upstream.input;
    } else {
      reject("input", reason);
    }
  }
  if (
    upstream.output !== undefined &&
    Math.abs(entry.pricing.output - upstream.output) > EPSILON
  ) {
    const reason = priceRejection(entry.pricing.output, upstream.output);
    if (reason === undefined) {
      note("output", entry.pricing.output, upstream.output);
      entry.pricing.output = upstream.output;
    } else {
      reject("output", reason);
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
  return { applied, rejected };
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");

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

  const drifted: string[] = [];
  const rejected: string[] = [];
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
      continue;
    }
    const result = reconcile(
      id,
      entry,
      upstream,
      fromModelsDev === undefined ? "litellm" : "models.dev",
    );
    drifted.push(...result.applied);
    rejected.push(...result.rejected);
  }

  emit("== LLM catalog cross-check ==");
  emit(
    drifted.length > 0
      ? `\nDrift vs upstreams (${check ? "not applied" : "applied"}):\n${drifted.join("\n")}`
      : "\nNo input/output/context drift vs upstreams.",
  );
  if (rejected.length > 0) {
    emit(
      `\nWITHHELD by plausibility guards — verify against the provider's own pricing page before applying by hand:\n${rejected.join("\n")}`,
    );
  }
  if (overlayOnly.length > 0) {
    emit(
      `\nOverlay-only (absent from both upstreams under their own provider — verify manually):\n  ${overlayOnly.join("\n  ")}`,
    );
  }
  if (notChecked.length > 0) {
    emit(`\nNot cross-checked:\n  ${notChecked.join("\n  ")}`);
  }

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
  if (check && drifted.length > 0) {
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
