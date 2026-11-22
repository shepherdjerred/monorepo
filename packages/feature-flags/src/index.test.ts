import { afterEach, describe, expect, test, vi } from "vitest";
import {
  initFeatureFlags,
  isEnabled,
  numberValue,
  refreshFlagSnapshot,
  shutdownFeatureFlags,
  stringValue,
} from "@shepherdjerred/feature-flags/index.ts";
import {
  FlagNotFoundError,
  isAbsent,
} from "@shepherdjerred/feature-flags/flag-result.ts";
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
    const result = await isEnabled("ai_reports_enabled", {
      default: false,
      targetingKey: "service",
    });
    expect(result.value).toBe(false);
    expect(result.errorCode).toBe("PROVIDER_NOT_READY");
    expect(isAbsent(result)).toBe(true);
  });

  test("returns the call-site default rather than a fixed false", async () => {
    await initFeatureFlags({ environment: DISABLED });
    // The default IS the answer when nothing is configured, so a `true` default
    // must survive. Returning `false` here would silently disable features the
    // moment flags were introduced.
    const result = await isEnabled("ai_reports_enabled", {
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
      provider: new StaticProvider({ ai_reports_enabled: true }),
    });
    const result = await isEnabled("ai_reports_enabled", {
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
      provider: new StaticProvider({ ai_reports_enabled: false }),
    });
    const result = await isEnabled("ai_reports_enabled", {
      default: true,
      targetingKey: "service",
    });
    expect(result.value).toBe(false);
    expect(result.reason).toBe("STATIC");
    expect(isAbsent(result)).toBe(false);
  });

  test("an undefined flag throws FlagNotFoundError", async () => {
    await initFeatureFlags({
      environment: DISABLED,
      provider: new StaticProvider({ ai_reports_enabled: true }),
    });
    await expect(
      isEnabled("dares_enabled", {
        default: false,
        targetingKey: "service",
      }),
    ).rejects.toThrow(FlagNotFoundError);
  });

  test("a type mismatch is an error, NOT absence", async () => {
    // A wrong-typed override means the source has an opinion it cannot express.
    // Falling through would mask a real configuration bug behind a lower layer.
    await initFeatureFlags({
      environment: DISABLED,
      provider: new StaticProvider({
        ai_reports_enabled: "not-a-boolean",
      }),
    });
    const result = await isEnabled("ai_reports_enabled", {
      default: false,
      targetingKey: "service",
    });
    expect(result.errorCode).toBe("TYPE_MISMATCH");
    expect(isAbsent(result)).toBe(false);
  });

  test("resolves string and number flags", async () => {
    await initFeatureFlags({
      environment: DISABLED,
      provider: new StaticProvider({
        "scout-report-ai-model": "gpt-5.6-sol",
        "llm-hourly-token-budget": 0.33,
      }),
    });
    await expect(
      stringValue("scout-report-ai-model", {
        default: "fallback",
        targetingKey: "service",
      }),
    ).resolves.toMatchObject({ value: "gpt-5.6-sol", reason: "STATIC" });
    await expect(
      numberValue("llm-hourly-token-budget", {
        default: 1,
        targetingKey: "service",
      }),
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
      observeProviderInfo: () => {
        /* Provider identity is covered by observability.test.ts. */
      },
    } satisfies FlagMetricsRecorder;

    await initFeatureFlags({
      environment: DISABLED,
      metrics,
      onInitializationFailure: (message) => failures.push(message),
      providerFactory: () => {
        attempts++;
        const provider = new StaticProvider(
          attempts < 3 ? {} : { ai_reports_enabled: true },
        );
        if (attempts < 3) {
          Object.defineProperty(provider, "initialize", {
            value: () => Promise.reject(new Error("backend unreachable")),
          });
        }
        return provider;
      },
    });

    const unavailable = await isEnabled("ai_reports_enabled", {
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
      isEnabled("ai_reports_enabled", {
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
        : new Promise<void>(() => {
            // Never settles by design: the attempt hangs until retry.
          }),
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
          attempts === 3 ? { ai_reports_enabled: true } : {},
        );
        Object.defineProperty(provider, "initialize", {
          value:
            attempts === 1
              ? () => Promise.reject(new Error("backend unreachable"))
              : attempts === 2
                ? () =>
                    new Promise<void>(() => {
                      // Never settles by design: the attempt hangs until retry.
                    })
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
      isEnabled("ai_reports_enabled", {
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

describe("flags mode", () => {
  test("wires FlagsProvider from FEATURE_FLAGS_MODE=flags and supports evaluation and fresh checks", async () => {
    const requests: { url: string; headers: Headers }[] = [];
    let online = true;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const headers = new Headers(init?.headers);
      requests.push({ url, headers });
      if (!online) {
        return Promise.reject(new Error("offline"));
      }
      if (headers.get("if-none-match") === '"4"') {
        return Promise.resolve(
          new Response(null, { status: 304, headers: { ETag: '"4"' } }),
        );
      }
      return Promise.resolve(
        Response.json(
          {
            deployment: "scout/prod",
            revision: 4,
            flags: [
              {
                type: "boolean",
                key: "ai_reports_enabled",
                default: false,
                rollouts: [],
              },
              {
                type: "variant",
                key: "scout-report-ai-model",
                value: "gpt-6-luna",
              },
              {
                type: "variant",
                key: "llm-hourly-token-budget",
                value: "0.5",
              },
            ],
          },
          { headers: { ETag: '"4"' } },
        ),
      );
    });

    await initFeatureFlags({
      environment: {
        FEATURE_FLAGS_MODE: "flags",
        FLAGS_URL: "http://flags.invalid:8080",
        FLAGS_DEPLOYMENT: "scout/prod",
      },
    });

    expect(requests[0]?.url).toBe(
      "http://flags.invalid:8080/v1/deployments/scout/prod/snapshot",
    );
    expect(requests[0]?.headers.get("authorization")).toBeNull();

    const off = await isEnabled("ai_reports_enabled", {
      default: true,
      targetingKey: "service",
    });
    expect(off.value).toBe(false);
    expect(isAbsent(off)).toBe(false);

    await expect(
      stringValue("scout-report-ai-model", {
        default: "fallback",
        targetingKey: "service",
      }),
    ).resolves.toMatchObject({ value: "gpt-6-luna" });

    await expect(
      numberValue("llm-hourly-token-budget", {
        default: 1,
        targetingKey: "service",
      }),
    ).resolves.toMatchObject({ value: 0.5 });

    await expect(refreshFlagSnapshot()).resolves.toBe(true);

    await expect(
      isEnabled("dares_enabled", {
        default: false,
        targetingKey: "service",
      }),
    ).rejects.toThrow(FlagNotFoundError);

    online = false;
    await expect(refreshFlagSnapshot()).resolves.toBe(false);
    await expect(
      isEnabled("ai_reports_enabled", {
        default: true,
        targetingKey: "service",
      }),
    ).resolves.toMatchObject({ value: false });
  });

  test("createFlagConfigSource degrades on HTTP 200 body transport failure during requireFreshSnapshot", async () => {
    const { createFlagConfigSource } =
      await import("@shepherdjerred/feature-flags/config-source.ts");
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve(
          Response.json({
            deployment: "woodpecker/prod",
            revision: 1,
            flags: [
              {
                type: "boolean",
                key: "woodpecker-source-cache-enabled",
                default: true,
                rollouts: [],
              },
            ],
          }),
        );
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new TypeError("terminated"));
        },
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    });

    await initFeatureFlags({
      environment: {
        FEATURE_FLAGS_MODE: "flags",
        FLAGS_URL: "http://flags.invalid:8080",
        FLAGS_DEPLOYMENT: "woodpecker/prod",
      },
    });

    const unavailableFlags: string[] = [];
    const source = createFlagConfigSource({
      targetingKey: "main",
      kinds: { sourceCache: "boolean" },
      requireFreshSnapshot: true,
      onUnavailable: (flag) => unavailableFlags.push(flag),
    });

    await expect(
      source.get({
        key: "sourceCache",
        flag: "woodpecker-source-cache-enabled",
      }),
    ).resolves.toBeUndefined();
    expect(unavailableFlags).toEqual(["woodpecker-source-cache-enabled"]);
  });

  test("degrades cleanly to PROVIDER_NOT_READY on initial outage and recovers in background", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let online = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      if (!online) return Promise.reject(new Error("connect ECONNREFUSED"));
      return Promise.resolve(
        Response.json({
          deployment: "scout/prod",
          revision: 1,
          flags: [
            {
              type: "boolean",
              key: "ai_reports_enabled",
              default: true,
              rollouts: [],
            },
          ],
        }),
      );
    });

    const failures: string[] = [];
    await initFeatureFlags({
      environment: {
        FEATURE_FLAGS_MODE: "flags",
        FLAGS_URL: "http://flags.invalid:8080",
        FLAGS_DEPLOYMENT: "scout/prod",
      },
      onInitializationFailure: (message) => failures.push(message),
    });

    const duringOutage = await isEnabled("ai_reports_enabled", {
      default: false,
      targetingKey: "service",
    });
    expect(duringOutage.value).toBe(false);
    expect(isAbsent(duringOutage)).toBe(true);
    expect(failures).toHaveLength(1);

    online = true;
    await vi.advanceTimersByTimeAsync(1000);
    await expect(
      isEnabled("ai_reports_enabled", {
        default: false,
        targetingKey: "service",
      }),
    ).resolves.toMatchObject({ value: true, errorCode: undefined });
  });
});
