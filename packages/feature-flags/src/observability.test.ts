import { afterEach, describe, expect, test } from "vitest";
import {
  initFeatureFlags,
  isEnabled,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags/index.ts";
import {
  createFlagMetricsRecorder,
  FEATURE_FLAG_METRIC_LABELS,
} from "@shepherdjerred/feature-flags/observability.ts";
import type { EvaluationEvent } from "@shepherdjerred/feature-flags/observability.ts";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { FliptProvider } from "@shepherdjerred/feature-flags/providers/flipt.ts";
import { createFakeFetcher } from "@shepherdjerred/feature-flags/providers/fake-fetcher.ts";
import snapshot from "@shepherdjerred/feature-flags/providers/fixtures/flipt-snapshot.default.json" with { type: "json" };

afterEach(async () => {
  await shutdownFeatureFlags();
});

function createTestMetricsRecorder() {
  const evaluations: unknown[] = [];
  const errors: unknown[] = [];
  const providerReadiness: number[] = [];
  const snapshotAges: number[] = [];
  const recorder = createFlagMetricsRecorder({
    evaluations: { inc: (labels) => evaluations.push(labels) },
    errors: { inc: (labels) => errors.push(labels) },
    providerReady: { set: (value) => providerReadiness.push(value) },
    snapshotAge: { set: (value) => snapshotAges.push(value) },
  });
  return { recorder, evaluations, errors, providerReadiness, snapshotAges };
}

describe("metric naming", () => {
  test("targetingKey is never a label", () => {
    // It is a guild or user id, so it would be unbounded cardinality.
    const everyLabel = Object.values(FEATURE_FLAG_METRIC_LABELS).flat();
    expect(everyLabel).not.toContain("targetingKey");
  });

  test("adapts counters and gauges without owning their registry", () => {
    const { recorder, evaluations, errors, providerReadiness, snapshotAges } =
      createTestMetricsRecorder();

    recorder.countEvaluation({
      flag: "known-flag",
      reason: "STATIC",
      errorCode: undefined,
    });
    recorder.countError("initialize");
    recorder.observeProviderReady(false);
    recorder.observeProviderReady(true);
    recorder.observeSnapshotAge(42);

    expect(evaluations).toEqual([{ flag: "known-flag", reason: "STATIC" }]);
    expect(errors).toEqual([{ operation: "initialize" }]);
    expect(providerReadiness).toEqual([0, 1]);
    expect(snapshotAges).toEqual([42]);
  });
});

describe("evaluation instrumentation", () => {
  test("reports the flag, reason, and error code for every evaluation", async () => {
    const events: EvaluationEvent[] = [];
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({ ai_reports_enabled: true }),
      onEvaluation: (event) => events.push(event),
    });

    await isEnabled("ai_reports_enabled", {
      default: false,
      targetingKey: "service",
    });
    await expect(
      isEnabled("betting_enabled", {
        default: false,
        targetingKey: "service",
      }),
    ).rejects.toThrow();

    expect(events).toEqual([
      { flag: "ai_reports_enabled", reason: "STATIC", errorCode: undefined },
      { flag: "betting_enabled", reason: "ERROR", errorCode: "FLAG_NOT_FOUND" },
    ]);
  });

  test("counts FLAG_NOT_FOUND as an evaluation error", async () => {
    const { recorder, errors } = createTestMetricsRecorder();
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({ ai_reports_enabled: true }),
      metrics: recorder,
    });

    await isEnabled("ai_reports_enabled", {
      default: false,
      targetingKey: "service",
    });
    await expect(
      isEnabled("betting_enabled", {
        default: false,
        targetingKey: "service",
      }),
    ).rejects.toThrow();

    expect(errors).toEqual([{ operation: "evaluate" }]);
  });

  test("the observer is cleared on shutdown", async () => {
    const events: EvaluationEvent[] = [];
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({ ai_reports_enabled: true }),
      onEvaluation: (event) => events.push(event),
    });
    await shutdownFeatureFlags();

    await isEnabled("ai_reports_enabled", {
      default: false,
      targetingKey: "service",
    });
    expect(events).toEqual([]);
  });
});

describe("snapshot age", () => {
  test("is undefined before initialize and zero-ish after", async () => {
    // The outage signal: during a backend outage the client keeps serving its
    // last good snapshot, so evaluations still succeed and nothing looks wrong.
    // A rising age is what tells an operator the values are frozen.
    const provider = new FliptProvider({
      url: "http://flipt.invalid:8080",
      namespace: "default",
      environment: "default",
      pollIntervalSeconds: 300,
      fetcher: createFakeFetcher({ kind: "snapshot", body: snapshot }).fetcher,
    });

    expect(provider.snapshotAgeSeconds()).toBeUndefined();
    await provider.initialize();
    const age = provider.snapshotAgeSeconds();
    expect(age).toBeDefined();
    expect(age ?? Number.POSITIVE_INFINITY).toBeLessThan(5);

    await provider.onClose();
    expect(provider.snapshotAgeSeconds()).toBeUndefined();
  });
});
