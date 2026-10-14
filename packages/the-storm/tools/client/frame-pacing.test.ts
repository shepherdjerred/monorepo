import { describe, expect, it } from "vitest";
import wire from "#client-frame-pacing-wire";
import { validateFramePacing } from "./frame-pacing-wire.ts";
import { compareFramePacing } from "./frame-pacing.ts";

function receipt() {
  return {
    schema: 1,
    kind: "rwf-native-frame-pacing",
    source: "game-renderer-tail-monotonic-nanos",
    complete: true,
    error: "",
    name: "baseline",
    world: "minecraft:rwf",
    requestedDurationMs: 1000,
    requestedFrames: 5,
    completion: "FRAME_LIMIT",
    observedElapsedNanos: 98_000_000,
    measuredDurationNanos: 98_000_000,
    tailNanos: 0,
    settings: {
      width: 1280,
      height: 720,
      windowWidth: 1280,
      windowHeight: 720,
      fpsCap: 120,
      vsync: true,
      renderDistance: 12,
      effectiveRenderDistance: 12,
      simulationDistance: 8,
      graphicsPreset: "fancy",
      fullscreen: false,
      fov: 70,
    },
    runtime: {
      javaVersion: "25",
      javaVendor: "example",
      osName: "Mac OS X",
      osVersion: "26",
      osArch: "aarch64",
      minecraftVersion: "26.2",
      gpuName: "example",
      gpuVendor: "example",
      gpuDriver: "example",
      gpuBackend: "Metal",
      code: wire.codeResources.map((file) => ({
        file,
        sha256: "a".repeat(64),
      })),
    },
    observations: [0, 16_000_000, 32_000_000, 82_000_000, 98_000_000].map(
      (elapsedNanos, index, times) => ({
        index,
        elapsedNanos,
        intervalNanos: index === 0 ? 0 : elapsedNanos - (times[index - 1] ?? 0),
        worldTick: 3,
        focused: true,
        screenOpen: false,
        effectiveFpsCap: 120,
        camera: { x: 1, y: 2, z: 3, yaw: 0, pitch: 45 },
      }),
    ),
    quantiles: {
      intervals: 4,
      meanNanos: 24_500_000,
      p50Nanos: 16_000_000,
      p95Nanos: 50_000_000,
      p99Nanos: 50_000_000,
      maxNanos: 50_000_000,
    },
  };
}

describe("original native frame pacing", () => {
  it("recomputes a long frame and compares identical configured windows without inventing a pass bar", () => {
    const original = validateFramePacing(receipt());
    expect(original.quantiles.p99Nanos).toBe(50_000_000);
    expect(compareFramePacing(original, original)).toMatchObject({
      p95ChangeNanos: 0,
      performanceAccepted: false,
    });
  });

  it("rejects changed interval order, tail time, quantiles and producer identities", () => {
    const changed = receipt();
    const frame = changed.observations[2];
    if (frame === undefined) throw new Error("Missing fixture frame");
    frame.intervalNanos++;
    expect(() => validateFramePacing(changed)).toThrow("clock changed");
    const tail = receipt();
    tail.tailNanos = 1;
    expect(() => validateFramePacing(tail)).toThrow("completion");
    const quantile = receipt();
    quantile.quantiles.p99Nanos = 16_000_000;
    expect(() => validateFramePacing(quantile)).toThrow("quantiles");
    const producer = receipt();
    producer.runtime.code.reverse();
    expect(() => validateFramePacing(producer)).toThrow(
      "fingerprint inventory",
    );
  });

  it("does not compare a different FPS cap or client runtime to the baseline", () => {
    const baseline = validateFramePacing(receipt());
    const cap = receipt();
    cap.settings.fpsCap = 60;
    expect(() =>
      compareFramePacing(baseline, validateFramePacing(cap)),
    ).toThrow("different render settings");
    const runtime = receipt();
    runtime.runtime.javaVersion = "26";
    expect(() =>
      compareFramePacing(baseline, validateFramePacing(runtime)),
    ).toThrow("different render settings");
  });

  it("rejects a different world or camera motion in either original window", () => {
    const baseline = validateFramePacing(receipt());
    const world = receipt();
    world.world = "minecraft:overworld";
    expect(() =>
      compareFramePacing(baseline, validateFramePacing(world)),
    ).toThrow("same world and camera");
    const moving = receipt();
    const frame = moving.observations.at(-1);
    if (frame === undefined) throw new Error("Missing fixture frame");
    frame.camera.x += 0.1;
    expect(() =>
      compareFramePacing(baseline, validateFramePacing(moving)),
    ).toThrow("same world and camera");
    expect(() =>
      compareFramePacing(validateFramePacing(moving), baseline),
    ).toThrow("same world and camera");
    const wrapped = receipt();
    for (const observation of wrapped.observations)
      observation.camera.yaw = 360;
    expect(
      compareFramePacing(baseline, validateFramePacing(wrapped))
        .performanceAccepted,
    ).toBe(false);
  });
});
