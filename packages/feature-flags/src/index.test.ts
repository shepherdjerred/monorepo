import { afterEach, describe, expect, test, vi } from "vitest";
import {
  initFeatureFlags,
  isEnabled,
  numberValue,
  shutdownFeatureFlags,
  stringValue,
} from "@shepherdjerred/feature-flags/index.ts";
import { isAbsent } from "@shepherdjerred/feature-flags/flag-result.ts";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import type { FlagMetricsRecorder } from "@shepherdjerred/feature-flags/observability.ts";

const DISABLED = { FEATURE_FLAGS_MODE: "disabled" } as const;

function shutdownRetryHarness(initialize: (attempt: number) => Promise<void>): {
  readonly providerFactory: () => StaticProvider;
  readonly attempts: () => number;
  readonly closes: () => number;
} {
  let attempts = 0;
  let closes = 0;
  return {
    providerFactory: () => {
      attempts++;
      const provider = new StaticProvider({});
      Object.defineProperties(provider, {
        initialize: { value: () => initialize(attempts) },
        onClose: {
          value: () => {
            closes++;
            return Promise.resolve();
          },
        },
      });
      return provider;
    },
    attempts: () => attempts,
    closes: () => closes,
  };
}

afterEach(async () => {
  await shutdownFeatureFlags();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("disabled mode", () => {
  test("reports every flag absent so callers fall through to lower layers", async () => {
    await initFeatureFlags({ environment: DISABLED });
    const result = await isEnabled("anything", {
      default: false,
      targetingKey: "service",
    });
    expect(result.value).toBe(false);
    expect(result.errorCode).toBe("FLAG_NOT_FOUND");
    expect(isAbsent(result)).toBe(true);
  });

  test("returns the call-site default rather than a fixed false", async () => {
    await initFeatureFlags({ environment: DISABLED });
    // The default IS the answer when nothing is configured, so a `true` default
    // must survive. Returning `false` here would silently disable features the
    // moment flags were introduced.
    const result = await isEnabled("anything", {
      default: true,
      targetingKey: "service",
    });
    expect(result.value).toBe(true);
  });
});

describe("static mode", () => {
  test("a defined flag RESOLVES and is not absent", async () => {
    await initFeatureFlags({
      environment: DISABLED,
      provider: new StaticProvider({ "known-flag": true }),
    });
    const result = await isEnabled("known-flag", {
      default: false,
      targetingKey: "service",
    });
    expect(result.value).toBe(true);
    expect(isAbsent(result)).toBe(false);
  });

  test("a flag defined as FALSE resolves — it must not fall through", async () => {
    // This is the single most important assertion in the package. A flag
    // deliberately turned off must stop the waterfall. If it reported absence,
    // `@shepherdjerred/config` would descend to an env var still set to `true`
    // and silently re-enable the thing an operator just disabled.
    await initFeatureFlags({
      environment: DISABLED,
      provider: new StaticProvider({ "kill-switch": false }),
    });
    const result = await isEnabled("kill-switch", {
      default: true,
      targetingKey: "service",
    });
    expect(result.value).toBe(false);
    expect(result.reason).toBe("STATIC");
    expect(isAbsent(result)).toBe(false);
  });

  test("an undefined flag is absent even when others are defined", async () => {
    await initFeatureFlags({
      environment: DISABLED,
      provider: new StaticProvider({ "known-flag": true }),
    });
    const result = await isEnabled("missing-flag", {
      default: false,
      targetingKey: "service",
    });
    expect(isAbsent(result)).toBe(true);
  });

  test("a type mismatch is an error, NOT absence", async () => {
    // A wrong-typed override means the source has an opinion it cannot express.
    // Falling through would mask a real configuration bug behind a lower layer.
    await initFeatureFlags({
      environment: DISABLED,
      provider: new StaticProvider({ "wrong-type": "not-a-boolean" }),
    });
    const result = await isEnabled("wrong-type", {
      default: false,
      targetingKey: "service",
    });
    expect(result.errorCode).toBe("TYPE_MISMATCH");
    expect(isAbsent(result)).toBe(false);
  });

  test("resolves string and number flags", async () => {
    await initFeatureFlags({
      environment: DISABLED,
      provider: new StaticProvider({ model: "gpt-5.6-sol", threshold: 0.33 }),
    });
    await expect(
      stringValue("model", { default: "fallback", targetingKey: "service" }),
    ).resolves.toMatchObject({ value: "gpt-5.6-sol", reason: "STATIC" });
    await expect(
      numberValue("threshold", { default: 1, targetingKey: "service" }),
    ).resolves.toMatchObject({ value: 0.33, reason: "STATIC" });
  });
});

describe("initialization", () => {
  test("a provider that fails to initialize does not throw", async () => {
    // A flag backend outage must not stop a service from booting. Evaluations
    // degrade to call-site defaults, which are current production behavior.
    const failing = new StaticProvider({});
    Object.defineProperty(failing, "initialize", {
      value: () => Promise.reject(new Error("backend unreachable")),
    });
    await expect(
      initFeatureFlags({ environment: DISABLED, provider: failing }),
    ).resolves.toBeUndefined();
  });

  test("rejects ambiguous provider overrides", async () => {
    const provider = new StaticProvider({});
    await expect(
      initFeatureFlags({
        environment: DISABLED,
        provider,
        providerFactory: () => provider,
      }),
    ).rejects.toThrow("provider and providerFactory are mutually exclusive");
  });

  test("retries with fresh providers until the existing client recovers", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let attempts = 0;
    let evaluations = 0;
    let snapshotObservations = 0;
    const readiness: boolean[] = [];
    const initializationErrors: string[] = [];
    const failures: string[] = [];
    const metrics = {
      countEvaluation: () => {
        evaluations++;
      },
      countError: (operation) => {
        if (operation === "initialize") initializationErrors.push(operation);
      },
      observeProviderReady: (ready) => readiness.push(ready),
      observeSnapshotAge: () => {
        snapshotObservations++;
      },
    } satisfies FlagMetricsRecorder;

    await initFeatureFlags({
      environment: DISABLED,
      metrics,
      onInitializationFailure: (message) => failures.push(message),
      providerFactory: () => {
        attempts++;
        const provider = new StaticProvider(
          attempts < 3 ? {} : { "known-flag": true },
        );
        if (attempts < 3) {
          Object.defineProperty(provider, "initialize", {
            value: () => Promise.reject(new Error("backend unreachable")),
          });
        }
        return provider;
      },
    });

    const unavailable = await isEnabled("known-flag", {
      default: false,
      targetingKey: "service",
    });
    expect(unavailable.value).toBe(false);
    expect(isAbsent(unavailable)).toBe(true);
    expect(attempts).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(attempts).toBe(3);

    await expect(
      isEnabled("known-flag", {
        default: false,
        targetingKey: "service",
      }),
    ).resolves.toMatchObject({ value: true, reason: "STATIC" });
    expect(initializationErrors).toHaveLength(2);
    expect(failures).toHaveLength(1);
    expect(evaluations).toBe(2);
    expect(snapshotObservations).toBe(0);
    expect(failures[0]).toContain("retries in the background");
    expect(readiness.at(0)).toBe(false);
    expect(readiness.at(-1)).toBe(true);
  });

  test("shutdown cancels a pending retry and closes the failed provider", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const harness = shutdownRetryHarness(() =>
      Promise.reject(new Error("backend unreachable")),
    );

    await initFeatureFlags({
      environment: DISABLED,
      providerFactory: harness.providerFactory,
    });

    await shutdownFeatureFlags();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.attempts()).toBe(1);
    expect(harness.closes()).toBe(1);
  });

  test("shutdown cancels an in-flight retry initialization", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const harness = shutdownRetryHarness((attempt) =>
      attempt === 1
        ? Promise.reject(new Error("backend unreachable"))
        : new Promise<void>((resolve) => void resolve),
    );

    await initFeatureFlags({
      environment: DISABLED,
      providerFactory: harness.providerFactory,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.attempts()).toBe(2);
    await expect(shutdownFeatureFlags()).resolves.toBeUndefined();
    expect(harness.closes()).toBe(2);
  });

  test("times out a stalled retry and continues with a fresh provider", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let attempts = 0;

    await initFeatureFlags({
      environment: DISABLED,
      providerFactory: () => {
        attempts++;
        const provider = new StaticProvider(
          attempts === 3 ? { "known-flag": true } : {},
        );
        Object.defineProperty(provider, "initialize", {
          value:
            attempts === 1
              ? () => Promise.reject(new Error("backend unreachable"))
              : attempts === 2
                ? () => new Promise<void>((resolve) => void resolve)
                : () => Promise.resolve(),
        });
        return provider;
      },
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(attempts).toBe(3);
    await expect(
      isEnabled("known-flag", {
        default: false,
        targetingKey: "service",
      }),
    ).resolves.toMatchObject({ value: true, reason: "STATIC" });
  });

  test("closes a timed-out provider again after late initialization", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const stalled = Promise.withResolvers<true>();
    const harness = shutdownRetryHarness(async (attempt) => {
      if (attempt === 1) throw new Error("backend unreachable");
      await stalled.promise;
    });

    await initFeatureFlags({
      environment: DISABLED,
      providerFactory: harness.providerFactory,
    });
    await vi.advanceTimersByTimeAsync(11_000);
    expect(harness.attempts()).toBe(2);
    expect(harness.closes()).toBe(2);

    stalled.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.closes()).toBe(3);
  });
});
