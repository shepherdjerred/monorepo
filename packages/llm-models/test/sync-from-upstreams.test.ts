import { describe, expect, test } from "vitest";
import {
  contextRejection,
  missingNativeRoute,
  patchRawCatalog,
  priceDecision,
  reconcile,
  verdictFor,
} from "#scripts/sync-from-upstreams.ts";
import {
  assertUpstreamCoverage,
  crossCheckedProviders,
  indexLiteLlm,
  indexModelsDev,
  mergeUpstreams,
  providerKey,
  type MergedUpstream,
  type Upstream,
} from "#scripts/upstreams.ts";
import { CatalogSchema, MODELS, type ModelEntry } from "#src/index.ts";

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
  google: {
    models: {
      "gemini-3.8-flash": {
        cost: { input: 0.75, output: 3.75 },
        limit: { context: 1_048_576 },
      },
    },
  },
  moonshotai: {
    models: {
      "kimi-k3.1-pro": {
        cost: { input: 2, output: 10 },
        limit: { context: 1_048_576 },
      },
      "kimi-k3.1-pro-highspeed": {
        cost: { input: 4, output: 20 },
        limit: { context: 1_048_576 },
      },
    },
  },
  xai: {
    models: {
      "grok-4.7": {
        cost: { input: 2, output: 6 },
        limit: { context: 500_000 },
      },
    },
  },
  // Regional CN pricing (CNY-converted decimals), subscription plans ($0), and
  // third-party gateways/resellers — listed after first parties as models.dev
  // orders them, and all excluded from the index.
  "moonshotai-cn": {
    models: {
      "kimi-k3.1-pro": {
        cost: { input: 1.9437, output: 10.1671 },
        limit: { context: 1_048_576 },
      },
      "kimi-k3.1-pro-highspeed": {
        cost: { input: 3.8874, output: 20.3342 },
        limit: { context: 1_048_576 },
      },
    },
  },
  "kimi-code-plan-global": {
    models: {
      "k3.1-pro": {
        cost: { input: 0, output: 0 },
        limit: { context: 1_048_576 },
      },
      "kimi-k3.1-pro": {
        cost: { input: 0, output: 0 },
        limit: { context: 1_048_576 },
      },
    },
  },
  "kimi-code-plan-cn": {
    models: {
      "k3.1-pro-highspeed": {
        cost: { input: 0, output: 0 },
        limit: { context: 1_048_576 },
      },
    },
  },
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
      "kimi-k3.1-pro": {
        cost: { input: 2.042, output: 10.209 },
        limit: { context: 1_048_576 },
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
  jzstoken: {
    models: {
      "grok-4.7": {
        cost: { input: 0.3892, output: 1.95 },
        limit: { context: 500_000 },
      },
    },
  },
  // An unmapped gateway claiming our internal `"moonshot"` name must not bind
  // over `moonshotai -> moonshot`.
  moonshot: {
    models: {
      "kimi-k3.1-pro": {
        cost: { input: 99, output: 99 },
        limit: { context: 8192 },
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
      capabilities: {
        inputModalities: ["text"],
        outputModalities: ["text"],
        tools: false,
        structuredOutputs: false,
        webSearch: false,
        reasoning: false,
        supportsTemperature: false,
        supportsTopP: false,
      },
      // No route: these cases exercise the pricing/context indexers and the
      // reconcile guards, never route availability.
      routes: {},
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

const SHARED_FIRST_PARTY_ROWS: readonly [string, string, Upstream][] = [
  [
    "anthropic",
    "claude-opus-5",
    { input: 5, output: 25, contextWindow: 1_000_000 },
  ],
  [
    "google",
    "gemini-3.8-flash",
    { input: 0.75, output: 3.75, contextWindow: 1_048_576 },
  ],
  [
    "moonshot",
    "kimi-k3.1-pro",
    { input: 2, output: 10, contextWindow: 1_048_576 },
  ],
  [
    "moonshot",
    "kimi-k3.1-pro-highspeed",
    { input: 4, output: 20, contextWindow: 1_048_576 },
  ],
  ["xai", "grok-4.7", { input: 2, output: 6, contextWindow: 500_000 }],
];

// Shapes taken from the live dataset: attribution lives in `litellm_provider`;
// rows may be bare (`claude-opus-5`) or carry their own `vendor/` prefix
// (`openai/gpt-5.5`, `moonshot/kimi-k3.1-pro`, `xai/grok-4.7`).
const LITELLM_FIXTURE = {
  // Resellers placed BEFORE first-party rows so first-wins would pick them if
  // vendor filtering ever regressed.
  "kyma/kimi-k3.1-pro": {
    litellm_provider: "kyma",
    input_cost_per_token: 0.0000027,
    output_cost_per_token: 0.0000135,
    max_input_tokens: 1_048_576,
  },
  "kyma/grok-4.7": {
    litellm_provider: "kyma",
    input_cost_per_token: 0.00000216,
    output_cost_per_token: 0.00000648,
    max_input_tokens: 500_000,
  },
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
  "gemini/gemini-3.8-flash": {
    litellm_provider: "gemini",
    input_cost_per_token: 0.00000075,
    output_cost_per_token: 0.00000375,
    max_input_tokens: 1_048_576,
  },
  "moonshot/kimi-k3.1-pro": {
    litellm_provider: "moonshot",
    input_cost_per_token: 0.000002,
    output_cost_per_token: 0.00001,
    max_input_tokens: 1_048_576,
  },
  "moonshot/kimi-k3.1-pro-highspeed": {
    litellm_provider: "moonshot",
    input_cost_per_token: 0.000004,
    output_cost_per_token: 0.00002,
    max_input_tokens: 1_048_576,
  },
  "xai/grok-4.7": {
    litellm_provider: "xai",
    input_cost_per_token: 0.000002,
    output_cost_per_token: 0.000006,
    max_input_tokens: 500_000,
  },
  "bedrock/anthropic.claude-opus-5": {
    litellm_provider: "bedrock",
    input_cost_per_token: 0.000006,
    output_cost_per_token: 0.00003,
    max_input_tokens: 200_000,
  },
  "together_ai/moonshotai/Kimi-K3.1-Pro": {
    litellm_provider: "together_ai",
    input_cost_per_token: 0.000002,
    output_cost_per_token: 0.00001,
    max_input_tokens: 1_048_576,
  },
  "us.xai.grok-4.7": {
    litellm_provider: "bedrock_converse",
    input_cost_per_token: 0.0000022,
    output_cost_per_token: 0.0000066,
    max_input_tokens: 524_288,
  },
  "moonshotai.kimi-k3.1": {
    litellm_provider: "bedrock_converse",
    input_cost_per_token: 0.0000044,
    output_cost_per_token: 0.000022,
    max_input_tokens: 868_928,
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
};

describe("indexModelsDev provider scoping", () => {
  const index = indexModelsDev(MODELS_DEV_FIXTURE);

  test.each(SHARED_FIRST_PARTY_ROWS)(
    "indexes %s:%s under our catalog creator id (mapping moonshotai -> moonshot)",
    (provider, id, expected) => {
      expect(index.get(providerKey(provider, id))).toEqual(expected);
    },
  );

  test("indexes openai entries and leaves raw moonshotai unindexed", () => {
    expect(index.get(providerKey("openai", "gpt-5.6-sol"))).toEqual({
      input: 5,
      output: 30,
      contextWindow: 1_050_000,
    });
    expect(
      index.get(providerKey("moonshotai", "kimi-k3.1-pro")),
    ).toBeUndefined();
  });

  test("excludes moonshotai-cn, kimi-code-plan-*, and third-party gateways", () => {
    for (const [vendor, id] of [
      ["moonshotai-cn", "kimi-k3.1-pro"],
      ["kimi-code-plan-global", "k3.1-pro"],
      ["kimi-code-plan-cn", "k3.1-pro-highspeed"],
      ["cortecs", "claude-opus-5"],
      ["jiekou", "claude-haiku-4-5-20251001"],
      ["jzstoken", "grok-4.7"],
      ["moonshot", "k3.1-pro"],
    ] as const) {
      expect(index.get(providerKey(vendor, id))).toBeUndefined();
    }
    // Neither `moonshotai-cn`, `kimi-code-plan-global`, `cortecs`, nor an
    // unmapped `moonshot` provider on models.dev overwrote `moonshotai`.
    expect(index.get(providerKey("moonshot", "kimi-k3.1-pro"))?.input).toBe(2);
  });

  test("a bare model id resolves to nothing", () => {
    for (const bareId of [
      "claude-opus-5",
      "gpt-5.6-sol",
      "kimi-k3.1-pro",
      "grok-4.7",
    ]) {
      expect(index.get(bareId)).toBeUndefined();
    }
  });
});

describe("indexLiteLlm provider scoping", () => {
  const index = indexLiteLlm(LITELLM_FIXTURE);

  test("keeps dots that belong to the model id", () => {
    expect(index.get(providerKey("openai", "gpt-5.5"))?.input).toBeCloseTo(
      5,
      9,
    );
  });

  test.each(SHARED_FIRST_PARTY_ROWS)(
    "indexes %s:%s across bare and vendor-prefixed first-party rows",
    (provider, id, expected) => {
      expect(index.get(providerKey(provider, id))).toEqual(expected);
    },
  );

  test("normalizes per-token openai float figures", () => {
    expect(
      index.get(providerKey("openai", "gpt-5.6-luna"))?.output,
    ).toBeCloseTo(1.2, 9);
  });

  test("does not adopt a gateway or reseller price as the first-party creator's", () => {
    // Bedrock, Kyma, Together AI, and Bedrock Converse resell weights at their
    // own prices and context limits. None may bind to our creator keys or
    // appear under reseller keys.
    expect(index.get(providerKey("anthropic", "claude-opus-5"))?.input).toBe(5);
    expect(index.get(providerKey("moonshot", "kimi-k3.1-pro"))?.input).toBe(2);
    expect(index.get(providerKey("xai", "grok-4.7"))?.input).toBe(2);
    expect(
      index.get(providerKey("anthropic", "anthropic.claude-opus-5")),
    ).toBeUndefined();
    expect(index.get(providerKey("openai", "claude-opus-5"))).toBeUndefined();
    expect(index.get(providerKey("kyma", "kimi-k3.1-pro"))).toBeUndefined();
    expect(index.get(providerKey("kyma", "grok-4.7"))).toBeUndefined();
    expect(
      index.get(providerKey("together_ai", "moonshotai/Kimi-K3.1-Pro")),
    ).toBeUndefined();
    expect(
      index.get(providerKey("bedrock_converse", "us.xai.grok-4.7")),
    ).toBeUndefined();
    expect(index.get(providerKey("moonshot", "kimi-k3.1"))).toBeUndefined();
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

/** A models.dev-only row, the ordinary case for the guard tests. */
function devRow(upstream: Upstream): MergedUpstream {
  const merged = mergeUpstreams(upstream, undefined);
  if (merged === undefined) {
    throw new Error("fixture supplied no upstream values");
  }
  return merged;
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
      devRow({ input: 5.5, output: 27 }),
      { now: NOW },
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
      devRow({ input: 1.5, output: 27.498, contextWindow: 20_000 }),
      { now: NOW },
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
      devRow({ contextWindow: 20_000 }),
      { now: NOW },
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
      devRow({ input: 2, output: 10 }),
      { now: NOW },
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
    const stillAccepted = reconcile("subject", before, devRow({ input: 2 }), {
      now: new Date("2026-08-31T23:59:59Z"),
    });
    expect(stillAccepted.applied).toHaveLength(0);
    expect(stillAccepted.rejected).toHaveLength(0);

    // Same upstream number, same catalog value — only the clock moved.
    const after = entry(acceptance);
    const lapsed = reconcile("subject", after, devRow({ input: 2 }), {
      now: new Date("2026-09-01T00:00:01Z"),
    });
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
    reconcile("subject", subject, devRow({ input: 4.5 }), { now: NOW });
    expect(subject.pricing).toMatchObject({ input: 4.5 });

    // Upstream returns to the accepted number. The pair no longer matches, so
    // this must be reconciled rather than silently suppressed.
    const afterReturn = reconcile("subject", subject, devRow({ input: 2 }), {
      now: NOW,
    });
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
    const applied = reconcile("subject", modest, devRow({ input: 4 }), {
      now: NOW,
    });
    expect(applied.applied).toHaveLength(1);
    expect(modest.pricing).toMatchObject({ input: 4 });

    // An implausible one still reaches the guard and is withheld.
    const drastic = entry(acceptance);
    const withheld = reconcile("subject", drastic, devRow({ input: 12 }), {
      now: NOW,
    });
    expect(withheld.rejected).toHaveLength(1);
    expect(withheld.rejected[0]).toContain("subject.input");
    expect(drastic.pricing).toMatchObject({ input: 5 });
  });

  test("still honours pinnedContextWindow", () => {
    const subject = entry({ pinnedContextWindow: true });
    const result = reconcile(
      "subject",
      subject,
      devRow({ contextWindow: 1_000_000 }),
      { now: NOW },
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(subject.contextWindow).toBe(200_000);
  });

  test("ignores image models entirely", () => {
    const subject = entry({
      pricing: {
        modality: "image",
        perImage: 0.134,
        inputPerMillionTokens: 2,
      },
      contextWindow: undefined,
    });
    const result = reconcile(
      "subject",
      subject,
      devRow({ input: 99, output: 99 }),
      { now: NOW },
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });
});

/** An entry override carrying one acceptance that expires at `expiresAt`. */
function accepted(expiresAt: string): Record<string, unknown> {
  return {
    acceptedUpstreamPricing: {
      input: { upstream: 2, catalog: 5 },
      reason: "introductory rate; catalog holds the standard price",
      expiresAt,
    },
  };
}

describe("acceptedUpstreamPricing.expiresAt timezone contract", () => {
  test("accepts a UTC instant", () => {
    expect(() => entry(accepted("2026-09-01T00:00:00Z"))).not.toThrow();
  });

  test("accepts a non-UTC offset, as the JSON Schema and Python view do", () => {
    // catalog.json is the language-neutral source of truth, so the three
    // validators must agree. Zod's bare `z.iso.datetime()` takes only `Z`,
    // which left an operator able to write a valid RFC 3339 acceptance that
    // Python and the JSON Schema read fine and TypeScript alone refused.
    expect(() => entry(accepted("2026-09-01T00:00:00-07:00"))).not.toThrow();
    expect(() => entry(accepted("2026-09-01T00:00:00+02:00"))).not.toThrow();
  });

  test("rejects a bare local time in every view", () => {
    // Aligning on RFC 3339 means tightening, not just widening: `expiresAt` is
    // an instant, and one ambiguous by hours cannot decide whether a
    // divergence is still accepted.
    expect(() => entry(accepted("2026-09-01T00:00:00"))).toThrow();
  });
});

describe("acceptedUpstreamPricing shape contract", () => {
  test("rejects an unknown key inside an acceptance", () => {
    // catalog.schema.json and the Pydantic view both forbid extras. Zod's
    // default `z.object` silently STRIPS them, so a typo like `inpt` parsed
    // clean in TypeScript while the acceptance it was meant to record simply
    // did not exist — an adjudication that looks saved and suppresses nothing.
    expect(() =>
      entry({
        acceptedUpstreamPricing: {
          inpt: { upstream: 2, catalog: 5 },
          reason: "typo'd key",
          expiresAt: "2026-09-01T00:00:00Z",
        },
      }),
    ).toThrow();
  });

  test("rejects an unknown key on the price pair itself", () => {
    expect(() =>
      entry({
        acceptedUpstreamPricing: {
          input: { upstream: 2, catalog: 5, note: "why" },
          reason: "extra key on the pair",
          expiresAt: "2026-09-01T00:00:00Z",
        },
      }),
    ).toThrow();
  });

  test("rejects an acceptance naming neither input nor output", () => {
    // Well-formed and inert: reconcile matches acceptances per field, so this
    // suppresses nothing while reading like a decision that was made.
    expect(() =>
      entry({
        acceptedUpstreamPricing: {
          reason: "no price recorded",
          expiresAt: "2026-09-01T00:00:00Z",
        },
      }),
    ).toThrow();
  });

  test("accepts an acceptance naming only one side", () => {
    // Only one of the two prices diverging is the common case.
    expect(() =>
      entry({
        acceptedUpstreamPricing: {
          output: { upstream: 10, catalog: 25 },
          reason: "output only",
          expiresAt: "2026-09-01T00:00:00Z",
        },
      }),
    ).not.toThrow();
  });
});

describe("mergeUpstreams", () => {
  test("fills a field models.dev omitted from the LiteLLM row", () => {
    // The whole-object preference discarded LiteLLM entirely whenever
    // models.dev had any row at all. The field then counted as unmeasured and
    // LlmCatalogEvidenceMissing announced that no upstream published it —
    // while LiteLLM had, and real drift in that number went unexamined.
    const merged = mergeUpstreams(
      { input: 2 },
      { input: 9, output: 10, contextWindow: 400_000 },
    );
    expect(merged).toEqual({
      // models.dev still wins where it actually has a value.
      input: { value: 2, source: "models.dev" },
      output: { value: 10, source: "litellm" },
      contextWindow: { value: 400_000, source: "litellm" },
    });
  });

  test("reports the true source per field, not per model", () => {
    // The reason strings name the source, so a merged row must not attribute
    // a LiteLLM number to models.dev.
    const subject = entry({});
    const merged = mergeUpstreams({ input: 5.5 }, { output: 40 });
    if (merged === undefined) {
      throw new Error("fixture supplied no upstream values");
    }
    const result = reconcile("subject", subject, merged, { now: NOW });
    expect(result.applied.join("\n")).toContain("subject.input");
    expect(result.applied.join("\n")).toContain("(models.dev)");
    // 25 -> 40 is a 60% change, so it is withheld, and cites litellm.
    expect(result.rejectedByField.output).toContain("(litellm)");
  });

  test("a field neither upstream published stays unmeasured", () => {
    const subject = entry({});
    const merged = mergeUpstreams({ input: 5 }, { input: 5 });
    const verdict = verdictFor(subject, merged, {
      applied: [],
      rejectedByField: {},
      rejected: [],
    });
    expect(verdict.measured).toEqual(["input"]);
    expect(verdict.unmeasured).toEqual(["output", "contextWindow"]);
  });

  test("two empty rows produce no upstream at all", () => {
    expect(mergeUpstreams(undefined, undefined)).toBeUndefined();
    expect(mergeUpstreams({}, {})).toBeUndefined();
  });
});

/** A text entry shaped like `text-embedding-3-small`: input-only pricing. */
function embedding(): ModelEntry {
  return entry({
    pricing: { modality: "text", input: 0.02, output: 0 },
    category: "embedding",
    contextWindow: 8191,
  });
}

describe("applicable fields for an embedding model", () => {
  test("does not treat output as a checkable dimension", () => {
    // Embeddings emit no output tokens. Marking `output` applicable made an
    // upstream that CORRECTLY omits the price look like missing evidence, so
    // LlmCatalogEvidenceMissing fired about a number that does not exist.
    const merged = mergeUpstreams({ input: 0.02 }, undefined);
    const verdict = verdictFor(embedding(), merged, {
      applied: [],
      rejectedByField: {},
      rejected: [],
    });
    expect(verdict.measured).toEqual(["input"]);
    expect(verdict.unmeasured).toEqual(["contextWindow"]);
    expect(verdict.unmeasured).not.toContain("output");
  });

  test("still cross-checks the dimensions an embedding does bill for", () => {
    // The narrowing must not turn into "skip embeddings" — the input price is
    // real, and a reseller markup on it is the exact failure this script
    // exists to catch. A 150% jump must still be caught and withheld.
    const subject = embedding();
    const merged = mergeUpstreams({ input: 0.05 }, undefined);
    if (merged === undefined) {
      throw new Error("fixture supplied no upstream values");
    }
    const result = reconcile("subject", subject, merged, { now: NOW });
    expect(result.rejectedByField.input).toContain("subject.input");
    // Withheld means the catalog keeps its own number.
    expect(subject.pricing).toMatchObject({ input: 0.02 });
  });

  test("an ordinary text model still checks output", () => {
    const merged = mergeUpstreams({ input: 5 }, undefined);
    const verdict = verdictFor(entry({}), merged, {
      applied: [],
      rejectedByField: {},
      rejected: [],
    });
    expect(verdict.unmeasured).toContain("output");
  });
});

function pricingOnly(provider: "moonshot" | "xai" = "moonshot"): ModelEntry {
  return entry({ provider, pricingOnly: true });
}

describe("pricingOnly entries", () => {
  test("are not reported as missing a native route", () => {
    expect(
      missingNativeRoute("subject", pricingOnly("moonshot")),
    ).toBeUndefined();
    expect(missingNativeRoute("subject", pricingOnly("xai"))).toBeUndefined();
    expect(missingNativeRoute("subject", entry({}))).toBe(
      "subject (current) has no native route",
    );
  });

  test("include their creators in crossCheckedProviders alongside routable text models", () => {
    const catalog = CatalogSchema.parse({
      routed: { ...entry({}), id: "routed" },
      kimi: { ...pricingOnly("moonshot"), id: "kimi" },
      grok: { ...pricingOnly("xai"), id: "grok" },
      imageOnly: {
        ...entry({
          provider: "google",
          pricing: {
            modality: "image",
            perImage: 0.134,
            inputPerMillionTokens: 2,
          },
          contextWindow: undefined,
        }),
        id: "imageOnly",
      },
    });
    expect(crossCheckedProviders(catalog)).toEqual(
      new Set(["anthropic", "moonshot", "xai"]),
    );
    expect(crossCheckedProviders(MODELS)).toEqual(
      new Set(["openai", "anthropic", "google", "moonshot", "xai", "meta"]),
    );
  });

  test("require upstream coverage for moonshot and xai", () => {
    const withoutMoonshot = merge(
      healthy("openai"),
      healthy("anthropic"),
      healthy("google"),
      healthy("xai"),
    );
    expect(() => {
      assertUpstreamCoverage(
        withoutMoonshot,
        new Map(),
        crossCheckedProviders(MODELS),
      );
    }).toThrow(/moonshot/);
  });

  test("cross-check kimi-k3.1-pro, kimi-k3.1-pro-highspeed, and grok-4.7 across both upstreams", () => {
    const modelsDev = indexModelsDev(MODELS_DEV_FIXTURE);
    const liteLlm = indexLiteLlm(LITELLM_FIXTURE);

    for (const id of [
      "kimi-k3.1-pro",
      "kimi-k3.1-pro-highspeed",
      "grok-4.7",
    ] as const) {
      const catalogEntry = structuredClone(MODELS[id]);
      if (catalogEntry === undefined) {
        throw new Error(`${id} missing from catalog`);
      }
      const key = providerKey(catalogEntry.provider, id);
      const fromBoth = mergeUpstreams(modelsDev.get(key), liteLlm.get(key));
      const fromLiteLlmOnly = mergeUpstreams(undefined, liteLlm.get(key));
      if (fromBoth === undefined || fromLiteLlmOnly === undefined) {
        throw new Error(`missing upstream row for ${key}`);
      }
      const result = reconcile(id, catalogEntry, fromBoth, { now: NOW });
      expect(result.applied).toEqual([]);
      expect(result.rejected).toEqual([]);
      expect(verdictFor(catalogEntry, fromBoth, result)).toEqual({
        withheld: {},
        measured: ["input", "output", "contextWindow"],
        unmeasured: [],
        retired: [],
      });
      expect(
        verdictFor(catalogEntry, fromLiteLlmOnly, result).measured,
      ).toEqual(["input", "output", "contextWindow"]);
    }
  });
});

describe("multi-endpoint native routes", () => {
  test("preserves gpt-6-luna decisions endpoint when upstream numeric drift is patched", () => {
    const luna = MODELS["gpt-6-luna"];
    if (luna === undefined) {
      throw new Error("gpt-6-luna missing from catalog");
    }
    expect(missingNativeRoute("gpt-6-luna", luna)).toBeUndefined();
    const rawCatalog: Record<string, unknown> = structuredClone({
      "gpt-6-luna": luna,
    });
    const parsedCatalog = CatalogSchema.parse(structuredClone(rawCatalog));
    const parsedLuna = parsedCatalog["gpt-6-luna"];
    if (parsedLuna === undefined) {
      throw new Error("parsed gpt-6-luna missing");
    }
    const result = reconcile(
      "gpt-6-luna",
      parsedLuna,
      devRow({ input: 0.12, output: 0.55 }),
      { now: NOW },
    );
    expect(result.applied).toHaveLength(2);
    const patched = CatalogSchema.parse(
      patchRawCatalog(rawCatalog, parsedCatalog),
    );
    expect(patched["gpt-6-luna"]?.routes.native).toEqual({
      provider: "openai",
      modelId: "gpt-6-luna",
      endpoints: ["language", "decisions"],
    });
  });
});
