/**
 * Telemetry router.
 *
 * This endpoint is public and unauthenticated, so the properties that matter
 * are the ones that stop it becoming a cardinality or spam vector: only enum
 * values are accepted, and the volume is bounded.
 */

import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import {
  OnboardingOutcomeSchema,
  OnboardingStepKindSchema,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";

const trpc = await createOfflineTrpcHarness("telemetry-router-test");

const { onboardingStepTotal, onboardingOutcomeTotal } =
  await import("#src/metrics/web.ts");
const { resetTelemetryRateLimitForTests } =
  await import("#src/trpc/router/telemetry.router.ts");

async function stepCount(step: string): Promise<number> {
  const metric = await onboardingStepTotal.get();
  return metric.values.find((value) => value.labels.step === step)?.value ?? 0;
}

async function outcomeCount(outcome: string): Promise<number> {
  const metric = await onboardingOutcomeTotal.get();
  return (
    metric.values.find((value) => value.labels.outcome === outcome)?.value ?? 0
  );
}

describe("telemetry router", () => {
  beforeEach(() => {
    resetTelemetryRateLimitForTests();
  });

  afterAll(async () => {
    await trpc.prisma.$disconnect();
  });

  it("records a step without requiring a session", async () => {
    const before = await stepCount("concepts");

    // Anonymous on purpose: the funnel starts before sign-in completes.
    const result = await trpc
      .anonCaller()
      .telemetry.onboardingStep({ step: "concepts" });

    expect(result.recorded).toBe(true);
    expect(await stepCount("concepts")).toBe(before + 1);
  });

  it("records a terminal outcome", async () => {
    const before = await outcomeCount("skipped");

    await trpc.anonCaller().telemetry.onboardingOutcome({ outcome: "skipped" });

    expect(await outcomeCount("skipped")).toBe(before + 1);
  });

  // The procedures validate with exactly these schemas, so an input the schema
  // rejects can never reach the counter. Asserting on the schema keeps the
  // guarantee under test without needing a type suppression to smuggle an
  // ill-typed value past the typed caller.
  it("accepts only enum step names as label values", () => {
    expect(OnboardingStepKindSchema.safeParse("concepts").success).toBe(true);
    for (const invalid of ["made-up-step", "", "concepts ", "CONCEPTS", "1"]) {
      expect(OnboardingStepKindSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("accepts only enum outcomes as label values", () => {
    expect(OnboardingOutcomeSchema.safeParse("completed").success).toBe(true);
    expect(OnboardingOutcomeSchema.safeParse("skipped").success).toBe(true);
    for (const invalid of ["exploded", "", "Completed"]) {
      expect(OnboardingOutcomeSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("does not let one caller shed everyone else's events", async () => {
    // A process-global counter let a single anonymous client spend the whole
    // per-minute allowance at the top of every window, silently replacing the
    // funnel signal with its own traffic.
    const noisy = trpc.anonCaller();
    for (let i = 0; i < 200; i += 1) {
      await noisy.telemetry.onboardingStep({ step: "install" });
    }

    // A different caller (distinct session) must still be recorded.
    const other = trpc.authedCaller();
    const result = await other.telemetry.onboardingStep({ step: "concepts" });
    expect(result.recorded).toBe(true);
  });

  it("sheds events once the rate limit is exhausted", async () => {
    const caller = trpc.anonCaller();
    let lastRecorded = true;
    // Well past the per-window budget; the endpoint must degrade rather than
    // let an unauthenticated caller spin the counters freely.
    for (let i = 0; i < 60; i += 1) {
      const result = await caller.telemetry.onboardingStep({ step: "install" });
      lastRecorded = result.recorded;
    }
    expect(lastRecorded).toBe(false);

    const settled = await stepCount("install");
    await caller.telemetry.onboardingStep({ step: "install" });
    expect(await stepCount("install")).toBe(settled);
  });
});
