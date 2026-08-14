import { describe, expect, test } from "bun:test";
import {
  assertUpstreamCoverage,
  contextRejection,
  indexLiteLlm,
  indexModelsDev,
  priceDecision,
  providerKey,
  reconcile,
  type Upstream,
} from "#scripts/sync-from-upstreams.ts";
import { CatalogSchema, type ModelEntry } from "#src/index.ts";

/**
 * A models.dev shape reproducing the exact collisions that poisoned the catalog
 * in PR #2102. Provider iteration order matters: the first-party entry comes
 * FIRST and the reseller LAST, which is what made a last-writer-wins flat index
 * pick the reseller every time.
 *
 * Values are the real ones observed on models.dev.
 */
/** Fixed clock: acceptance expiry is time-dependent, tests must not be. */
const NOW = new Date("2026-08-13T00:00:00Z");

const MODELS_DEV_FIXTURE = {
  anthropic: {
    models: {
      "claude-opus-5": {
        cost: { input: 5, output: 25 },
        limit: { context: 1_000_000 },
      },
      "claude-haiku-4-5-20251001": {
        cost: { input: 1, output: 5 },
        limit: { context: 200_000 },
      },
    },
  },
  openai: {
    models: {
      "gpt-5.6-sol": {
        cost: { input: 5, output: 30 },
        limit: { context: 1_050_000 },
      },
    },
  },
  // Resellers, listed after the first parties exactly as models.dev orders them.
  cortecs: {
    models: {
      "claude-opus-5": {
        cost: { input: 5.5, output: 27.498 },
        limit: { context: 1_000_000 },
      },
      "gpt-5.6-sol": {
        cost: { input: 5.5, output: 32.998 },
        limit: { context: 1_050_000 },
      },
    },
  },
  jiekou: {
    models: {
      "claude-haiku-4-5-20251001": {
        cost: { input: 0.9, output: 4.5 },
        limit: { context: 20_000 },
      },
    },
  },
};

function entry(overrides: Record<string, unknown>): ModelEntry {
  const catalog = CatalogSchema.parse({
    subject: {
      id: "subject",
      provider: "anthropic",
      displayName: "Subject",
      pricing: { modality: "text", input: 5, output: 25 },
      contextWindow: 200_000,
      capabilities: { supportsTemperature: false, supportsTopP: false },
      status: "current",
      ...overrides,
    },
  });
  const parsed = catalog["subject"];
  if (parsed === undefined) {
    throw new Error("fixture did not parse");
  }
  return parsed;
}

describe("indexModelsDev provider scoping", () => {
  const index = indexModelsDev(MODELS_DEV_FIXTURE);

  test("keys every model by provider, so resellers cannot overwrite first parties", () => {
    expect(index.get(providerKey("anthropic", "claude-opus-5"))).toEqual({
      input: 5,
      output: 25,
      contextWindow: 1_000_000,
    });
    // The reseller's entry still exists — under ITS OWN key, where a lookup
    // for the anthropic model will never find it.
    expect(index.get(providerKey("cortecs", "claude-opus-5"))).toEqual({
      input: 5.5,
      output: 27.498,
      contextWindow: 1_000_000,
    });
  });

  test("a bare model id resolves to nothing", () => {
    // The old flat index made this the lookup key, and it returned whichever
    // provider happened to come last.
    expect(index.get("claude-opus-5")).toBeUndefined();
    expect(index.get("gpt-5.6-sol")).toBeUndefined();
  });
});

describe("indexLiteLlm provider scoping", () => {
  // Shapes taken from the live dataset: attribution lives in
  // `litellm_provider`, and the DIRECT rows we buy from are keyed bare while
  // only gateway resales carry a `vendor/` prefix.
  const index = indexLiteLlm({
    "openai/gpt-5.5": {
      litellm_provider: "openai",
      input_cost_per_token: 0.000005,
      output_cost_per_token: 0.00003,
      max_input_tokens: 400_000,
    },
    "claude-opus-5": {
      litellm_provider: "anthropic",
      input_cost_per_token: 0.000005,
      output_cost_per_token: 0.000025,
      max_input_tokens: 1_000_000,
    },
    "gpt-5.6-luna": {
      litellm_provider: "openai",
      input_cost_per_token: 0.0000002,
      output_cost_per_token: 0.0000012,
      max_input_tokens: 1_050_000,
    },
    "bedrock/anthropic.claude-opus-5": {
      litellm_provider: "bedrock",
      input_cost_per_token: 0.000006,
      output_cost_per_token: 0.00003,
      max_input_tokens: 200_000,
    },
    // Unattributable: no `litellm_provider` at all.
    "some-random-model": {
      input_cost_per_token: 0.000001,
      output_cost_per_token: 0.000002,
    },
    // Unknown vendor — must not be attributed to one of our providers.
    "sagemaker/claude-opus-5": {
      litellm_provider: "sagemaker",
      input_cost_per_token: 0.000009,
      output_cost_per_token: 0.00009,
    },
  });

  test("keeps dots that belong to the model id", () => {
    expect(index.get(providerKey("openai", "gpt-5.5"))?.input).toBeCloseTo(
      5,
      9,
    );
  });

  test("indexes the bare direct-provider keys the fallback exists to read", () => {
    // The canonical anthropic/openai rows have no `vendor/` prefix. Requiring
    // a slash dropped every one of them, so models.dev going quiet on a model
    // left it reported as overlay-only instead of falling back to LiteLLM.
    expect(index.get(providerKey("anthropic", "claude-opus-5"))).toEqual({
      input: 5,
      output: 25,
      contextWindow: 1_000_000,
    });
    expect(
      index.get(providerKey("openai", "gpt-5.6-luna"))?.output,
    ).toBeCloseTo(1.2, 9);
  });

  test("does not adopt a gateway's price as the direct provider's", () => {
    // Bedrock resells Anthropic weights at AWS's price ($6/$30 here). Treating
    // that as "anthropic" is the same mistake as trusting cortecs — we buy
    // direct, so the anthropic key must hold the direct row's $5/$25.
    expect(index.get(providerKey("anthropic", "claude-opus-5"))?.input).toBe(5);
    expect(
      index.get(providerKey("anthropic", "anthropic.claude-opus-5")),
    ).toBeUndefined();
    expect(index.get(providerKey("openai", "claude-opus-5"))).toBeUndefined();
  });

  test("skips keys it cannot attribute rather than guessing", () => {
    // The old code stripped every prefix and indexed the bare remainder, so
    // these could bind to one of our clean ids non-deterministically.
    expect(
      index.get(providerKey("anthropic", "some-random-model")),
    ).toBeUndefined();
    expect(index.get("some-random-model")).toBeUndefined();
    expect(index.get(providerKey("anthropic", "sagemaker"))).toBeUndefined();
    // The unknown vendor's row keeps its full key out of our namespace too.
    expect(
      index.get(providerKey("anthropic", "sagemaker/claude-opus-5")),
    ).toBeUndefined();
  });
});

/** One index entry under `provider`, standing in for a healthy payload. */
function healthy(provider: string): Map<string, Upstream> {
  return new Map([
    [providerKey(provider, "some-model"), { input: 1, output: 2 }],
  ]);
}

function merge(...maps: Map<string, Upstream>[]): Map<string, Upstream> {
  return new Map(maps.flatMap((map) => [...map.entries()]));
}

describe("assertUpstreamCoverage", () => {
  const providers = new Set(["openai", "anthropic"]);

  test("accepts indexes that cover every cross-checked provider", () => {
    expect(() => {
      assertUpstreamCoverage(
        merge(healthy("openai"), healthy("anthropic")),
        healthy("openai"),
        providers,
      );
    }).not.toThrow();
  });

  test("rejects two empty indexes rather than reading them as no drift", () => {
    // A 200 with `{}` or a reshaped body indexes nothing. With no source left,
    // every model falls through to overlay-only and the report looks
    // byte-identical to a clean run — which would resolve a real open alert.
    expect(() => {
      assertUpstreamCoverage(new Map(), new Map(), providers);
    }).toThrow(/no upstream returned usable models/);
  });

  test("names the empty fetch even when the catalog cross-checks no provider", () => {
    // The coverage loop is vacuous with no providers, so this is the only
    // check standing between a total fetch failure and a clean-looking report.
    expect(() => {
      assertUpstreamCoverage(new Map(), new Map(), new Set());
    }).toThrow(/no upstream returned usable models/);
  });

  test("one empty source cannot abort a run the other fully covers", () => {
    // LiteLLM is the fallback, so a transient empty payload from it is not a
    // reason to abandon a cross-check models.dev can still substantiate — and
    // aborting would take the whole weekly refresh down with it, publishing
    // neither a PR nor the withheld/evidence alerts.
    const complete = merge(healthy("openai"), healthy("anthropic"));
    expect(() => {
      assertUpstreamCoverage(complete, new Map(), providers);
    }).not.toThrow();
    // Symmetric: coverage is what matters, not which source supplied it.
    expect(() => {
      assertUpstreamCoverage(new Map(), complete, providers);
    }).not.toThrow();
  });

  test("a surviving source must still cover every provider", () => {
    // The relaxation above is not a licence to skip the real invariant: one
    // empty source plus a partial other is still an incomplete cross-check.
    expect(() => {
      assertUpstreamCoverage(healthy("openai"), new Map(), providers);
    }).toThrow(/anthropic/);
  });

  test("rejects a partial payload that covers no model for a provider", () => {
    expect(() => {
      assertUpstreamCoverage(healthy("openai"), healthy("openai"), providers);
    }).toThrow(/anthropic/);
  });

  test("tolerates one source covering a provider the other misses", () => {
    // LiteLLM is only a fallback; models.dev alone is still real evidence.
    expect(() => {
      assertUpstreamCoverage(
        merge(healthy("openai"), healthy("anthropic")),
        new Map([[providerKey("openai", "only-one"), { input: 1 }]]),
        providers,
      );
    }).not.toThrow();
  });
});

/** The withheld reason, asserting the guard fired at all. */
function reasonFor(before: number, after: number): string {
  const decision = priceDecision(before, after);
  if (decision.kind !== "withhold") {
    throw new Error(
      `expected ${String(after)} to be withheld, got ${String(decision.value)}`,
    );
  }
  return decision.reason;
}

describe("plausibility guards", () => {
  test("rejects prices with more than two decimal places", () => {
    // The #2102 tell: reseller markups produce 32.998 / 4.982 / 0.996.
    expect(reasonFor(30, 32.998)).toContain("decimal places");
    expect(reasonFor(5, 4.982)).toContain("decimal places");
    expect(reasonFor(1, 0.996)).toContain("decimal places");
  });

  test("accepts ordinary round prices within the change bound", () => {
    expect(priceDecision(5, 5.5)).toEqual({ kind: "apply", value: 5.5 });
    expect(priceDecision(3, 2.5)).toEqual({ kind: "apply", value: 2.5 });
    expect(priceDecision(0.075, 0.08)).toEqual({ kind: "apply", value: 0.08 });
  });

  test("accepts a float artifact of our own per-million conversion", () => {
    // LiteLLM lists $0.20/M as 0.0000002/token; `perMillion` multiplies that
    // to 0.19999999999999998, which stringifies with 17 decimals. Counting
    // those digits withheld a legitimate published price forever.
    const artifact = 0.0000002 * 1_000_000;
    expect(artifact.toString()).toBe("0.19999999999999998");
    // The applied value is the normalized one, so the artifact never reaches
    // catalog.json.
    expect(priceDecision(0.25, artifact)).toEqual({
      kind: "apply",
      value: 0.2,
    });
  });

  test("rejects a change larger than 25%", () => {
    expect(reasonFor(10, 3)).toContain("70% change");
    expect(reasonFor(5, 1.5)).toContain("70% change");
    expect(reasonFor(15, 5.55)).toContain("change");
  });

  test("rejects any context-window shrink and allows growth", () => {
    expect(contextRejection(200_000, 20_000)).toContain("shrinks");
    expect(contextRejection(1_000_000, 200_000)).toContain("shrinks");
    expect(contextRejection(400_000, 1_050_000)).toBeUndefined();
    expect(contextRejection(200_000, 200_000)).toBeUndefined();
  });
});

describe("reconcile applies plausible drift and withholds the rest", () => {
  test("applies a modest, round price change", () => {
    const subject = entry({});
    const result = reconcile(
      "subject",
      subject,
      { input: 5.5, output: 27 },
      { source: "models.dev", now: NOW },
    );
    expect(result.rejected).toHaveLength(0);
    expect(result.applied).toHaveLength(2);
    expect(subject.pricing).toMatchObject({ input: 5.5, output: 27 });
  });

  test("withholds the #2102 edits and leaves the catalog untouched", () => {
    const subject = entry({});
    const result = reconcile(
      "subject",
      subject,
      // Fable-5-style repricing plus Haiku's context cut.
      { input: 1.5, output: 27.498, contextWindow: 20_000 },
      { source: "models.dev", now: NOW },
    );

    expect(result.applied).toHaveLength(0);
    expect(result.rejected).toHaveLength(3);
    // The entry must be byte-for-byte what it was.
    expect(subject.pricing).toMatchObject({ input: 5, output: 25 });
    expect(subject.contextWindow).toBe(200_000);
  });

  test("a withheld edit names the field and the reason", () => {
    const subject = entry({});
    const result = reconcile(
      "subject",
      subject,
      { contextWindow: 20_000 },
      { source: "models.dev", now: NOW },
    );
    expect(result.rejected[0]).toContain("subject.contextWindow");
    expect(result.rejected[0]).toContain("shrinks");
    expect(result.rejected[0]).toContain("models.dev");
  });

  test("skips an upstream price a human already declined", () => {
    // The claude-sonnet-5 case: upstream lists the introductory rate, the
    // catalog holds the standard one on purpose. Without this the guard
    // re-reports the same divergence every week forever.
    const subject = entry({
      acceptedUpstreamPricing: {
        input: { upstream: 2, catalog: 5 },
        output: { upstream: 10, catalog: 25 },
        reason: "introductory rate; catalog holds the standard price",
        expiresAt: "2026-09-01T00:00:00Z",
      },
    });
    const result = reconcile(
      "subject",
      subject,
      { input: 2, output: 10 },
      { source: "models.dev", now: NOW },
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(subject.pricing).toMatchObject({ input: 5, output: 25 });
  });

  test("lapses once its expiry passes, so the decision is re-adjudicated", () => {
    // The Sonnet 5 case is explicitly time-bound. If the promotion is extended
    // past the date, an acceptance with no machine-readable expiry would keep
    // matching the same numbers and suppress it forever with nothing to
    // trigger another look.
    const acceptance = {
      acceptedUpstreamPricing: {
        input: { upstream: 2, catalog: 5 },
        reason: "introductory rate; catalog holds the standard price",
        expiresAt: "2026-09-01T00:00:00Z",
      },
    };

    const before = entry(acceptance);
    const stillAccepted = reconcile(
      "subject",
      before,
      { input: 2 },
      { source: "models.dev", now: new Date("2026-08-31T23:59:59Z") },
    );
    expect(stillAccepted.applied).toHaveLength(0);
    expect(stillAccepted.rejected).toHaveLength(0);

    // Same upstream number, same catalog value — only the clock moved.
    const after = entry(acceptance);
    const lapsed = reconcile(
      "subject",
      after,
      { input: 2 },
      { source: "models.dev", now: new Date("2026-09-01T00:00:01Z") },
    );
    expect(lapsed.applied.length + lapsed.rejected.length).toBe(1);
  });

  test("lapses once the catalog value it protected has moved", () => {
    // The acceptance is a claim about a pair. If only the upstream half were
    // checked, this sequence would silently protect a value nobody reviewed:
    // an intermediate plausible price applies, upstream swings back to the
    // accepted number, and the guard suppresses the difference forever.
    const subject = entry({
      acceptedUpstreamPricing: {
        input: { upstream: 2, catalog: 5 },
        reason: "introductory rate; catalog holds the standard price",
        expiresAt: "2026-09-01T00:00:00Z",
      },
    });

    // Upstream moves to a plausible intermediate value: applied, so the
    // catalog side of the accepted pair no longer holds.
    reconcile(
      "subject",
      subject,
      { input: 4.5 },
      { source: "models.dev", now: NOW },
    );
    expect(subject.pricing).toMatchObject({ input: 4.5 });

    // Upstream returns to the accepted number. The pair no longer matches, so
    // this must be reconciled rather than silently suppressed.
    const afterReturn = reconcile(
      "subject",
      subject,
      { input: 2 },
      { source: "models.dev", now: NOW },
    );
    expect(afterReturn.applied.length + afterReturn.rejected.length).toBe(1);
  });

  test("accepts one value, not the field — a later repricing reopens", () => {
    // The whole reason this records a value instead of a mute flag. Accepting
    // $2 must not swallow a later move to some other number, whichever side of
    // the plausibility guard that number falls on.
    const acceptance = {
      acceptedUpstreamPricing: {
        input: { upstream: 2, catalog: 5 },
        reason: "introductory rate; catalog holds the standard price",
        expiresAt: "2026-09-01T00:00:00Z",
      },
    };

    // A plausible new price is applied, not silently ignored.
    const modest = entry(acceptance);
    const applied = reconcile(
      "subject",
      modest,
      { input: 4 },
      { source: "models.dev", now: NOW },
    );
    expect(applied.applied).toHaveLength(1);
    expect(modest.pricing).toMatchObject({ input: 4 });

    // An implausible one still reaches the guard and is withheld.
    const drastic = entry(acceptance);
    const withheld = reconcile(
      "subject",
      drastic,
      { input: 12 },
      { source: "models.dev", now: NOW },
    );
    expect(withheld.rejected).toHaveLength(1);
    expect(withheld.rejected[0]).toContain("subject.input");
    expect(drastic.pricing).toMatchObject({ input: 5 });
  });

  test("still honours pinnedContextWindow", () => {
    const subject = entry({ pinnedContextWindow: true });
    const result = reconcile(
      "subject",
      subject,
      { contextWindow: 1_000_000 },
      { source: "models.dev", now: NOW },
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(subject.contextWindow).toBe(200_000);
  });

  test("ignores image models entirely", () => {
    const subject = entry({
      pricing: { modality: "image", perImage: 0.134 },
      contextWindow: undefined,
    });
    const result = reconcile(
      "subject",
      subject,
      { input: 99, output: 99 },
      { source: "models.dev", now: NOW },
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });
});
