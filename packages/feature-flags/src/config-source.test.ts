import { afterEach, describe, expect, test, vi } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags/index.ts";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { FliptProvider } from "@shepherdjerred/feature-flags/providers/flipt.ts";
import { createFakeFetcher } from "@shepherdjerred/feature-flags/providers/fake-fetcher.ts";
import snapshot from "@shepherdjerred/feature-flags/providers/fixtures/flipt-snapshot.default.json" with { type: "json" };

afterEach(async () => {
  await shutdownFeatureFlags();
});

const NAMES = { key: "featureOn", flag: "ai_reports_enabled" } as const;

describe("flag config source — fresh authority", () => {
  test.each(["uninitialized", "disabled", "static", "outage"])(
    "strict %s configuration cannot authorize writes or hide invalid declared keys",
    async (mode) => {
      await shutdownFeatureFlags();
      const fake = createFakeFetcher({ kind: "snapshot", body: snapshot });
      if (mode === "outage") {
        await initFeatureFlags({
          environment: { FEATURE_FLAGS_MODE: "disabled" },
          provider: new FliptProvider({
            url: "http://flipt.invalid:8080",
            namespace: "default",
            environment: "default",
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
      ...snapshot,
      flags: snapshot.flags.map((flag) => ({
        ...flag,
        key: flag.key === "plain-on" ? NAMES.flag : flag.key,
      })),
    };
    const fake = createFakeFetcher({ kind: "snapshot", body });
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new FliptProvider({
        url: "http://flipt.invalid:8080",
        namespace: "default",
        environment: "default",
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
      body: { namespace: { key: "default" }, flags: "invalid" },
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

  test("an undefined flag in provider throws so the resolver does not silently descend", async () => {
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
