import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  setRwfDenied,
  setRwfFeatures,
  setRwfKits,
  startFakeBrain,
} from "#e2e/harness/fake-brain.ts";
import {
  CapacityFeatureReceiptSchema,
  configureCapacityFeatures,
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

it("evaluates credentialless /v1/evaluate requests and rejects credentialed calls", async () => {
  const brain = startFakeBrain(crypto.randomUUID());
  const base = `http://127.0.0.1:${brain.port.toString()}`;
  const player = crypto.randomUUID();
  try {
    const credentialed = await fetch(`${base}/v1/evaluate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret",
      },
      body: JSON.stringify({
        deployment: "minecraft/tsmc",
        key: "the-storm-staff-tools-enabled",
        context: { user: player },
      }),
    });
    expect(credentialed.status).toBe(400);

    const evaluate = async (key: string, context: Record<string, string>) => {
      const response = await fetch(`${base}/v1/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deployment: "minecraft/tsmc", key, context }),
      });
      expect(response.status).toBe(200);
      return z
        .strictObject({ enabled: z.boolean() })
        .parse(await response.json());
    };

    expect(
      await evaluate("the-storm-staff-tools-enabled", { user: player }),
    ).toEqual({ enabled: true });
    expect(
      await evaluate("the-storm-stargates-enabled", {
        server: "the-storm-server",
      }),
    ).toEqual({ enabled: true });
    expect(await evaluate("the-storm-companions-enabled", {})).toEqual({
      enabled: false,
    });
    expect(
      await evaluate("the-storm-rwf-enabled", { user: player, world: "rwf" }),
    ).toEqual({ enabled: true });
    await setRwfDenied(brain.port, [player]);
    expect(
      await evaluate("the-storm-rwf-enabled", { user: player, world: "rwf" }),
    ).toEqual({ enabled: false });
    await setRwfKits(brain.port, [player], []);
    expect(
      await evaluate("the-storm-rwf-kits-enabled", {
        user: player,
        world: "rwf",
      }),
    ).toEqual({ enabled: true });
    expect(
      await evaluate("the-storm-rwf-killstreaks-enabled", {
        user: player,
        world: "rwf",
      }),
    ).toEqual({ enabled: false });
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
