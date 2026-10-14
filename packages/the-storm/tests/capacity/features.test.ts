import { afterEach, expect, it, vi } from "vitest";
import { startFakeBrain, setRwfFeatures } from "#e2e/harness/fake-brain.ts";
import {
  configureCapacityFeatures,
  CapacityFeatureReceiptSchema,
} from "./features.ts";

afterEach(() => vi.unstubAllEnvs());

it("enables exact actual capacity flags before the caller starts Paper and reads back the other flags off", async () => {
  vi.stubEnv("STORM_E2E_BRAIN_HOST", "127.0.0.1");
  const brain = startFakeBrain(crypto.randomUUID());
  try {
    const actual = await configureCapacityFeatures("capacity", brain.port);
    if (actual === null) throw new Error("capacity bootstrap missing");
    expect(actual.previous).toEqual([]);
    expect(actual.appliesBeforeBoot).toBe(true);
    expect(
      actual.evaluations
        .filter((entry) => entry.enabled)
        .map((entry) => entry.key),
    ).toEqual(actual.enabled);
    expect(await setRwfFeatures(brain.port, [])).toEqual(actual.enabled);
    expect(() =>
      CapacityFeatureReceiptSchema.parse({
        ...actual,
        evaluations: actual.evaluations.slice(1),
      }),
    ).toThrow();
    expect(() =>
      CapacityFeatureReceiptSchema.parse({
        ...actual,
        appliesBeforeBoot: false,
      }),
    ).toThrow();
    expect(() =>
      CapacityFeatureReceiptSchema.parse({
        ...actual,
        evaluations: actual.evaluations.map((entry) => ({
          ...entry,
          enabled: false,
        })),
      }),
    ).toThrow("readback");
  } finally {
    await brain.stop();
  }
});

it("preserves all noncapacity profiles without changing the fake brain or contacting a server", async () => {
  vi.stubEnv("STORM_E2E_BRAIN_HOST", "127.0.0.1");
  const brain = startFakeBrain(crypto.randomUUID());
  try {
    for (const profile of ["e2e", "full", "load"] as const) {
      expect(await configureCapacityFeatures(profile, brain.port)).toBeNull();
      expect(await setRwfFeatures(brain.port, [])).toEqual([]);
      expect(await configureCapacityFeatures(profile, 0)).toBeNull();
    }
  } finally {
    await brain.stop();
  }
});

it("refuses a remote brain override before any capacity bootstrap write", async () => {
  vi.stubEnv("STORM_E2E_BRAIN_HOST", "remote.invalid");
  await expect(configureCapacityFeatures("capacity", 0)).rejects.toThrow();
});
