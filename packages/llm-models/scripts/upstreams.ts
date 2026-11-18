/**
 * Upstream dataset indexing, first-party creator scoping, coverage assertions,
 * and field-level merging for `sync-from-upstreams.ts`.
 */
import { z } from "zod";
import type { Catalog, ModelCreator } from "#src/index.ts";

const UnknownRecord = z.record(z.string(), z.unknown());

/**
 * The three values we cross-check. This is the comparison atom — reconcile has
 * exactly one block per field and nothing finer exists, which is why alert
 * identity bottoms out at (model, field).
 */
export type CrossCheckField = "input" | "output" | "contextWindow";

/** Per-1M-token input/output (+ context) — the fields we cross-check. */
export type Upstream = {
  input?: number | undefined;
  output?: number | undefined;
  contextWindow?: number | undefined;
};

/**
 * One upstream value and the source that published it, as a single unit.
 *
 * Deliberately inseparable. Provenance used to be one string for the whole
 * model, which only worked while a model's values all came from one row.
 */
export type MeasuredField = { readonly value: number; readonly source: string };

/** A model's cross-checkable values after both upstreams are considered. */
export type MergedUpstream = Partial<Record<CrossCheckField, MeasuredField>>;

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

/**
 * models.dev provider ids we accept, mapped onto our `ModelCreator` ids.
 *
 * Scoped to the five first-party creators whose models we price (`openai`,
 * `anthropic`, `google`, `moonshotai` -> `moonshot`, `xai`). Regional mirrors
 * with currency-converted rates (`moonshotai-cn`), subscription-plan zero-cost
 * rows (`kimi-code-plan-*`), and third-party gateways/resellers (`cortecs`,
 * `jiekou`, `requesty`, etc.) are excluded so lookup only ever sees the
 * creator's own published USD list prices and limits.
 */
const MODELS_DEV_VENDOR_TO_PROVIDER = new Map<string, ModelCreator>([
  ["openai", "openai"],
  ["anthropic", "anthropic"],
  ["google", "google"],
  ["moonshotai", "moonshot"],
  ["xai", "xai"],
]);

/** models.dev: { provider: { models: { id: { cost:{input,output}, limit:{context} } } } } — already per-1M. */
export function indexModelsDev(raw: unknown): Map<string, Upstream> {
  const out = new Map<string, Upstream>();
  for (const [vendor, providerRaw] of Object.entries(record(raw))) {
    const provider = MODELS_DEV_VENDOR_TO_PROVIDER.get(vendor);
    if (provider === undefined) {
      continue;
    }
    for (const [id, modelRaw] of Object.entries(
      record(record(providerRaw)["models"]),
    )) {
      const model = record(modelRaw);
      const cost = record(model["cost"]);
      out.set(providerKey(provider, id), {
        input: num(cost["input"]),
        output: num(cost["output"]),
        contextWindow: num(record(model["limit"])["context"]),
      });
    }
  }
  return out;
}

/**
 * LiteLLM `litellm_provider` values we accept, mapped onto our `ModelCreator` ids.
 *
 * Deliberately only the five first-party creators whose models we price
 * (`openai`, `anthropic`, `gemini` -> `google`, `moonshot`, `xai`). A key like
 * `bedrock/anthropic.claude-opus-5`, `azure/gpt-5.5`, `vertex_ai/gemini-x`,
 * `kyma/kimi-k3.1-pro`, `together_ai/moonshotai/Kimi-K3.1-Pro`, or
 * `us.xai.grok-4.7` (`bedrock_converse`) is a third-party reseller selling the
 * same weights at its own price — exactly the category of evidence that
 * poisoned the catalog in #2102. Those are skipped, so a model absent from its
 * own creator's rows falls through to "overlay-only" and gets reported for
 * manual review rather than silently adopting a gateway's markup.
 *
 * This also replaces the old alias-stripping, which chopped every `/` and `.`
 * prefix and indexed the bare remainder first-wins — letting a Bedrock or
 * Vertex row bind to one of our clean ids non-deterministically.
 */
const LITELLM_VENDOR_TO_PROVIDER = new Map<string, ModelCreator>([
  ["openai", "openai"],
  ["anthropic", "anthropic"],
  ["gemini", "google"],
  ["moonshot", "moonshot"],
  ["xai", "xai"],
]);

/**
 * LiteLLM: top-level { id: { litellm_provider, *_cost_per_token, max_input_tokens } } — per-TOKEN.
 *
 * Attribution comes from each row's `litellm_provider`, never from the key's
 * shape. Many direct-API rows are keyed BARE — `claude-opus-5`, `gpt-5.5` —
 * while others carry their own `vendor/` prefix (`openai/gpt-5.5`,
 * `moonshot/kimi-k3.1-pro`, `xai/grok-4.7`), so requiring or forbidding a slash
 * would drop legitimate first-party rows. A prefix is stripped only when it is
 * the row's own declared vendor, leaving the model id verbatim
 * (`openai/gpt-5.5` -> `gpt-5.5`, `xai/grok-4.7` -> `grok-4.7`, dots intact).
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
 * The creators whose text models an upstream must cover for the run to count
 * as a real cross-check. Both `models.dev` (`moonshotai` -> `moonshot`, `xai`)
 * and LiteLLM (`moonshot/*`, `xai/*`) publish first-party rows for all five
 * text-model creators (`openai`, `anthropic`, `google`, `moonshot`, `xai`), so
 * `pricingOnly` text entries participate in the same two-source cross-check and
 * coverage assertion as routable ones. Image-only entries stay excluded because
 * per-image pricing is not cross-checked.
 */
export function crossCheckedProviders(catalog: Catalog): ReadonlySet<string> {
  return new Set(
    Object.values(catalog)
      .filter((entry) => entry.pricing.modality === "text")
      .map((entry) => entry.provider),
  );
}

/**
 * Combine the two upstream rows field by field, models.dev winning only where
 * it actually published a value.
 *
 * Preferring the whole models.dev object discarded a LiteLLM value whenever
 * models.dev had a partial row. The field then counted as unmeasured and
 * `LlmCatalogEvidenceMissing` announced that no upstream published it — while
 * LiteLLM had, and any real drift in that number went unexamined. Precedence
 * is a tie-breaker between two values, not a reason to ignore the only one.
 */
export function mergeUpstreams(
  primary: Upstream | undefined,
  fallback: Upstream | undefined,
): MergedUpstream | undefined {
  const merged: MergedUpstream = {};
  for (const field of ["input", "output", "contextWindow"] as const) {
    const fromPrimary = primary?.[field];
    if (fromPrimary !== undefined) {
      merged[field] = { value: fromPrimary, source: "models.dev" };
      continue;
    }
    const fromFallback = fallback?.[field];
    if (fromFallback !== undefined) {
      merged[field] = { value: fromFallback, source: "litellm" };
    }
  }
  return Object.keys(merged).length === 0 ? undefined : merged;
}
