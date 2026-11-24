import { afterEach, describe, expect, test, vi } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags/index.ts";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import {
  FlagsProvider,
  type FlagsFetcher,
} from "@shepherdjerred/feature-flags/providers/flags.ts";

afterEach(async () => {
  await shutdownFeatureFlags();
});

const NAMES = { key: "featureOn", flag: "ai_reports_enabled" } as const;

type SnapshotBehavior =
  | { readonly kind: "snapshot"; readonly body: unknown }
  | { readonly kind: "network-error"; readonly message: string };

function createFlagsTestFetcher(initial: SnapshotBehavior): {
  readonly fetcher: FlagsFetcher;
  setBehavior: (next: SnapshotBehavior) => void;
  callCount: () => number;
} {
  let behavior = initial;
  let calls = 0;
  return {
    fetcher: () => {
      calls++;
      if (behavior.kind === "network-error") {
        return Promise.reject(new Error(behavior.message));
      }
      const body = behavior.body;
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        json: () => Promise.resolve(body),
      });
    },
    setBehavior: (next) => {
      behavior = next;
    },
    callCount: () => calls,
  };
}

describe("flag config source — fresh authority", () => {
  test.each(["uninitialized", "disabled", "static", "outage"])(
    "strict %s configuration cannot authorize writes or hide invalid declared keys",
    async (mode) => {
      await shutdownFeatureFlags();
      const fake = createFlagsTestFetcher({
        kind: "snapshot",
        body: {
          deployment: "scout/prod",
          revision: 1,
          flags: [
            {
              type: "boolean",
              key: NAMES.flag,
              default: true,
              rollouts: [],
            },
          ],
        },
      });
      if (mode === "outage") {
        await initFeatureFlags({
          environment: { FEATURE_FLAGS_MODE: "disabled" },
          provider: new FlagsProvider({
            url: "http://flags.invalid:8080",
            deployment: "scout/prod",
            pollIntervalSeconds: 300,
            fetcher: fake.fetcher,
          }),
        });
        fake.setBehavior({ kind: "network-error", message: "offline" });
      } else if (mode !== "uninitialized") {
        await initFeatureFlags({
          environment: { FEATURE_FLAGS_MODE: "disabled" },
          ...(mode === "static"
            ? { provider: new StaticProvider({ ai_reports_enabled: true }) }
            : {}),
        });
      }
      const onUnavailable = vi.fn();
      const source = createFlagConfigSource({
        targetingKey: "service",
        kinds: { featureOn: "boolean" },
        requireFreshSnapshot: true,
        onUnavailable,
      });
      await expect(source.get(NAMES)).resolves.toBeUndefined();
      expect(onUnavailable).toHaveBeenCalledExactlyOnceWith(NAMES.flag);
      for (const { kind, flag } of [
        { kind: "boolean", flag: "unknown-internal-key" },
        { kind: "boolean", flag: "woodpecker-log-retention-days" },
        { kind: "string", flag: NAMES.flag },
        { kind: "number", flag: NAMES.flag },
      ] as const) {
        const invalid = createFlagConfigSource({
          targetingKey: "service",
          kinds: { featureOn: kind },
          requireFreshSnapshot: true,
          onUnavailable,
        });
        await expect(
          invalid.get({ key: "featureOn", flag }),
        ).rejects.toMatchObject({
          name: "ConfigSourceFatalError",
          message: expect.stringContaining("is not defined for kind"),
        });
      }
      expect(onUnavailable).toHaveBeenCalledTimes(1);
      expect(fake.callCount()).toBe(mode === "outage" ? 2 : 0);
    },
  );

  test("strict keys share one transport check; a new source observes outage and recovery", async () => {
    const body = {
      deployment: "scout/prod",
      revision: 1,
      flags: [
        {
          type: "boolean",
          key: NAMES.flag,
          default: true,
          rollouts: [],
        },
      ],
    };
    const fake = createFlagsTestFetcher({ kind: "snapshot", body });
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new FlagsProvider({
        url: "http://flags.invalid:8080",
        deployment: "scout/prod",
        pollIntervalSeconds: 300,
        fetcher: fake.fetcher,
      }),
    });
    const unavailable = vi.fn();
    const createSource = () =>
      createFlagConfigSource({
        targetingKey: "service",
        kinds: { featureOn: "boolean", second: "boolean" },
        requireFreshSnapshot: true,
        onUnavailable: unavailable,
      });
    const source = createSource();
    expect(
      await Promise.all([
        source.get(NAMES),
        source.get({ ...NAMES, key: "second" }),
      ]),
    ).toEqual([{ value: true }, { value: true }]);
    expect(fake.callCount()).toBe(2);
    fake.setBehavior({ kind: "network-error", message: "offline" });
    await expect(createSource().get(NAMES)).resolves.toBeUndefined();
    expect(unavailable).toHaveBeenCalledExactlyOnceWith(NAMES.flag);
    fake.setBehavior({
      kind: "snapshot",
      body: { deployment: "scout/prod", revision: 1, flags: "invalid" },
    });
    await expect(createSource().get(NAMES)).rejects.toMatchObject({
      name: "ConfigSourceFatalError",
      message: "Fresh flag snapshot contract invalid",
    });
    fake.setBehavior({ kind: "snapshot", body });
    await expect(createSource().get(NAMES)).resolves.toEqual({ value: true });
    expect(fake.callCount()).toBe(5);
  });
});

describe("flag config source", () => {
  test("a resolved flag answers with its value", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({ ai_reports_enabled: true }),
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: { featureOn: "boolean" },
    });
    await expect(source.get(NAMES)).resolves.toEqual({ value: true });
  });

  test("a flag resolving FALSE answers — it does not report absence", async () => {
    // The composition-level statement of the same property the provider tests
    // assert: this is what stops the resolver descending to a stale env var.
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({ ai_reports_enabled: false }),
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: { featureOn: "boolean" },
    });
    await expect(source.get(NAMES)).resolves.toEqual({ value: false });
  });

  test("an undefined flag in StaticProvider throws so local static overrides do not silently drift", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({}),
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: { featureOn: "boolean" },
    });
    await expect(source.get(NAMES)).rejects.toThrow(/evaluation failed/);
  });

  test("an inventory-declared key missing from an active FlagsProvider degrades via onUnavailable while undeclared keys stay fatal", async () => {
    const fake = createFlagsTestFetcher({
      kind: "snapshot",
      body: {
        deployment: "scout/prod",
        revision: 1,
        flags: [],
      },
    });
    const events: unknown[] = [];
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new FlagsProvider({
        url: "http://flags.invalid:8080",
        deployment: "scout/prod",
        pollIntervalSeconds: 300,
        fetcher: fake.fetcher,
      }),
      onEvaluation: (event) => events.push(event),
    });
    const onUnavailable = vi.fn();
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: {
        featureOn: "boolean",
        model: "string",
        budget: "number",
        undeclared: "boolean",
      },
      onUnavailable,
    });

    await expect(source.get(NAMES)).resolves.toBeUndefined();
    await expect(
      source.get({ key: "model", flag: "scout-report-ai-model" }),
    ).resolves.toBeUndefined();
    await expect(
      source.get({ key: "budget", flag: "llm-hourly-token-budget" }),
    ).resolves.toBeUndefined();

    expect(onUnavailable).toHaveBeenCalledTimes(3);
    expect(onUnavailable).toHaveBeenNthCalledWith(1, NAMES.flag);
    expect(onUnavailable).toHaveBeenNthCalledWith(2, "scout-report-ai-model");
    expect(onUnavailable).toHaveBeenNthCalledWith(3, "llm-hourly-token-budget");
    expect(events).toContainEqual(
      expect.objectContaining({
        flag: NAMES.flag,
        errorCode: "FLAG_NOT_FOUND",
        value: "error",
      }),
    );

    await expect(
      source.get({ key: "undeclared", flag: "not-in-managed-inventory" }),
    ).rejects.toMatchObject({
      name: "ConfigSourceFatalError",
      message: expect.stringContaining("is not defined for kind"),
    });
    expect(onUnavailable).toHaveBeenCalledTimes(3);
  });

  test("an unavailable provider reports absence so the resolver descends", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
    });
    const onUnavailable = vi.fn();
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: { featureOn: "boolean" },
      onUnavailable,
    });
    await expect(source.get(NAMES)).resolves.toBeUndefined();
    expect(onUnavailable).toHaveBeenCalledWith(NAMES.flag);
  });

  test("a key with no declared kind is never asked of the flag layer", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({ ai_reports_enabled: true }),
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: {},
    });
    await expect(source.get(NAMES)).resolves.toBeUndefined();
  });

  test("resolves string and number kinds", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({
        "scout-report-ai-model": "gpt-5.6-sol",
        "llm-hourly-token-budget": 0.33,
      }),
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: { model: "string", threshold: "number" },
    });
    await expect(
      source.get({ key: "model", flag: "scout-report-ai-model" }),
    ).resolves.toEqual({
      value: "gpt-5.6-sol",
    });
    await expect(
      source.get({ key: "threshold", flag: "llm-hourly-token-budget" }),
    ).resolves.toEqual({ value: 0.33 });
  });

  test("a non-absence evaluation error is surfaced", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({
        ai_reports_enabled: "not-a-boolean",
      }),
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: { featureOn: "boolean" },
    });
    await expect(source.get(NAMES)).rejects.toThrow(/TYPE_MISMATCH/);
  });
});
