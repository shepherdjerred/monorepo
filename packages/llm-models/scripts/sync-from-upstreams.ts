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

/** models.dev: { provider: { models: { id: { cost:{input,output}, limit:{context} } } } } — already per-1M. */
function indexModelsDev(raw: unknown): Map<string, Upstream> {
  const out = new Map<string, Upstream>();
  for (const provider of Object.values(record(raw))) {
    for (const [id, modelRaw] of Object.entries(
      record(record(provider)["models"]),
    )) {
      const model = record(modelRaw);
      const cost = record(model["cost"]);
      out.set(id, {
        input: num(cost["input"]),
        output: num(cost["output"]),
        contextWindow: num(record(model["limit"])["context"]),
      });
    }
  }
  return out;
}

/** LiteLLM: top-level { id: { *_cost_per_token, max_input_tokens } } — per-TOKEN. Keys carry provider/date noise. */
function indexLiteLlm(raw: unknown): Map<string, Upstream> {
  const out = new Map<string, Upstream>();
  for (const [key, modelRaw] of Object.entries(record(raw))) {
    const model = record(modelRaw);
    const entry: Upstream = {
      input: perMillion(model["input_cost_per_token"]),
      output: perMillion(model["output_cost_per_token"]),
      contextWindow: num(model["max_input_tokens"]),
    };
    // Index under the raw key plus prefix/suffix-stripped aliases so our clean
    // ids (e.g. "claude-opus-4-8") match Bedrock/date-suffixed keys.
    const bare = key.includes("/") ? (key.split("/").pop() ?? key) : key;
    const noProvider = bare.includes(".")
      ? (bare.split(".").pop() ?? bare)
      : bare;
    for (const alias of new Set([key, bare, noProvider])) {
      if (!out.has(alias)) {
        out.set(alias, entry);
      }
    }
  }
  return out;
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

/** Mutates `entry` to match upstream input/output/context; returns drift messages. */
function reconcile(
  id: string,
  entry: ModelEntry,
  upstream: Upstream,
  source: string,
): string[] {
  if (entry.pricing.modality !== "text") {
    return [];
  }
  const messages: string[] = [];
  const note = (field: string, before: number, after: number): void => {
    messages.push(
      `  ${id}.${field}: ${String(before)} -> ${String(after)} (${source})`,
    );
  };

  if (
    upstream.input !== undefined &&
    Math.abs(entry.pricing.input - upstream.input) > EPSILON
  ) {
    note("input", entry.pricing.input, upstream.input);
    entry.pricing.input = upstream.input;
  }
  if (
    upstream.output !== undefined &&
    Math.abs(entry.pricing.output - upstream.output) > EPSILON
  ) {
    note("output", entry.pricing.output, upstream.output);
    entry.pricing.output = upstream.output;
  }
  if (
    upstream.contextWindow !== undefined &&
    entry.contextWindow !== undefined &&
    entry.contextWindow !== upstream.contextWindow &&
    !entry.pinnedContextWindow
  ) {
    note("contextWindow", entry.contextWindow, upstream.contextWindow);
    entry.contextWindow = upstream.contextWindow;
  }
  return messages;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");

  // Read the raw JSON text first so we can write it back without key reordering.
  // Zod's parse creates a new object with keys in schema-definition order; writing
  // the Zod-parsed output causes spurious diff churn on every refresh run.
  const rawText = await Bun.file(CATALOG_PATH).text();
  const rawCatalog = JSON.parse(rawText) as Record<
    string,
    Record<string, unknown>
  >;
  const catalog: Catalog = CatalogSchema.parse(JSON.parse(rawText));
  const [modelsDevRaw, liteLlmRaw] = await Promise.all([
    fetchJson(MODELS_DEV_URL),
    fetchJson(LITELLM_URL),
  ]);
  const modelsDev = indexModelsDev(modelsDevRaw);
  const liteLlm = indexLiteLlm(liteLlmRaw);

  const drifted: string[] = [];
  const overlayOnly: string[] = [];
  const notChecked: string[] = [];

  for (const [id, entry] of Object.entries(catalog)) {
    if (entry.pricing.modality !== "text") {
      notChecked.push(`${id} (image — per-image pricing not in upstreams)`);
      continue;
    }
    const upstream = modelsDev.get(id) ?? liteLlm.get(id);
    if (upstream === undefined) {
      overlayOnly.push(id);
      continue;
    }
    drifted.push(
      ...reconcile(
        id,
        entry,
        upstream,
        modelsDev.has(id) ? "models.dev" : "litellm",
      ),
    );
  }

  emit("== LLM catalog cross-check ==");
  emit(
    drifted.length > 0
      ? `\nDrift vs upstreams (${check ? "not applied" : "applied"}):\n${drifted.join("\n")}`
      : "\nNo input/output/context drift vs upstreams.",
  );
  if (overlayOnly.length > 0) {
    emit(
      `\nOverlay-only (absent from both upstreams — verify manually):\n  ${overlayOnly.join("\n  ")}`,
    );
  }
  if (notChecked.length > 0) {
    emit(`\nNot cross-checked:\n  ${notChecked.join("\n  ")}`);
  }

  if (drifted.length > 0 && !check) {
    // Patch only the drifted numeric fields into the raw JSON structure so that
    // key ordering and other non-numeric fields are preserved exactly as-is.
    for (const [id, entry] of Object.entries(catalog)) {
      const raw = rawCatalog[id];
      if (raw === undefined || entry.pricing.modality !== "text") {
        continue;
      }
      const rawPricing = raw["pricing"] as Record<string, unknown>;
      rawPricing["input"] = entry.pricing.input;
      rawPricing["output"] = entry.pricing.output;
      if (entry.contextWindow !== undefined) {
        raw["contextWindow"] = entry.contextWindow;
      }
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

void run();
