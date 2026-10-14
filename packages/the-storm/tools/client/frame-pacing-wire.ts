import { z } from "zod";
import wire from "#client-frame-pacing-wire";

const Nanos = z.number().int().nonnegative();
const Camera = z.strictObject({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  yaw: z.number(),
  pitch: z.number().min(-90).max(90),
});
export const PacingSettings = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  windowWidth: z.number().int().positive(),
  windowHeight: z.number().int().positive(),
  fpsCap: z.number().int().nonnegative(),
  vsync: z.boolean(),
  renderDistance: z.number().int().positive(),
  effectiveRenderDistance: z.number().int().positive(),
  simulationDistance: z.number().int().positive(),
  graphicsPreset: z.string().min(1),
  fullscreen: z.boolean(),
  fov: z.number().int().positive(),
});
const Code = z.strictObject({
  file: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
const Runtime = z.strictObject({
  javaVersion: z.string().min(1),
  javaVendor: z.string().min(1),
  osName: z.string().min(1),
  osVersion: z.string().min(1),
  osArch: z.string().min(1),
  minecraftVersion: z.string().min(1),
  gpuName: z.string().min(1),
  gpuVendor: z.string().min(1),
  gpuDriver: z.string().min(1),
  gpuBackend: z.string().min(1),
  code: z.array(Code).length(wire.codeResources.length),
});
const Observation = z.strictObject({
  index: z.number().int().nonnegative(),
  elapsedNanos: Nanos,
  intervalNanos: Nanos,
  worldTick: z.number().int().nonnegative(),
  focused: z.boolean(),
  screenOpen: z.boolean(),
  effectiveFpsCap: z.number().int().nonnegative(),
  camera: Camera,
});
const Quantiles = z.strictObject({
  intervals: z.number().int().positive(),
  meanNanos: z.number().positive(),
  p50Nanos: Nanos,
  p95Nanos: Nanos,
  p99Nanos: Nanos,
  maxNanos: Nanos,
});
export const FramePacingReceipt = z.strictObject({
  schema: z.literal(1),
  kind: z.literal("rwf-native-frame-pacing"),
  source: z.literal("game-renderer-tail-monotonic-nanos"),
  complete: z.literal(true),
  error: z.literal(""),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u),
  world: z.string().min(1),
  requestedDurationMs: z.number().int().min(1).max(60_000),
  requestedFrames: z.number().int().min(2).max(36_000),
  completion: z.enum(["DURATION", "FRAME_LIMIT"]),
  observedElapsedNanos: Nanos,
  measuredDurationNanos: Nanos,
  tailNanos: Nanos,
  settings: PacingSettings,
  runtime: Runtime,
  observations: z.array(Observation).min(2).max(36_000),
  quantiles: Quantiles,
});
export const FramePacingStatus = z.strictObject({
  name: z.string(),
  state: z.enum(["IDLE", "RUNNING", "WRITING", "COMPLETE", "FAILED"]),
  frames: z.number().int().min(0).max(36_000),
  error: z.string(),
  receipt: z.string(),
});
export type FramePacingReceipt = z.infer<typeof FramePacingReceipt>;

if (
  JSON.stringify(wire) !==
  JSON.stringify({
    version: 1,
    kind: "rwf-native-frame-pacing",
    source: "game-renderer-tail-monotonic-nanos",
    maximumDurationMs: 60_000,
    maximumFrames: 36_000,
    quantile: "nearest-rank",
    status: Object.keys(FramePacingStatus.shape),
    receipt: Object.keys(FramePacingReceipt.shape),
    observation: Object.keys(Observation.shape),
    quantiles: Object.keys(Quantiles.shape),
    settings: Object.keys(PacingSettings.shape),
    runtime: Object.keys(Runtime.shape),
    code: Object.keys(Code.shape),
    camera: Object.keys(Camera.shape),
    codeResources: wire.codeResources,
  })
)
  throw new Error("Unsupported native frame pacing contract");

/** Recompute frame intervals and statistics from the original ordered render callbacks. */
export function validateFramePacing(raw: unknown): FramePacingReceipt {
  const value = FramePacingReceipt.parse(raw);
  const duration = value.requestedDurationMs * 1_000_000;
  const last = value.observations.at(-1);
  if (last === undefined)
    throw new Error("Frame pacing observations are missing");
  if (
    value.measuredDurationNanos !==
      Math.min(duration, value.observedElapsedNanos) ||
    value.observations.length > value.requestedFrames ||
    value.tailNanos !== value.measuredDurationNanos - last.elapsedNanos ||
    (value.completion === "FRAME_LIMIT" &&
      (value.observations.length !== value.requestedFrames ||
        value.observedElapsedNanos !== last.elapsedNanos)) ||
    (value.completion === "DURATION" &&
      (value.observedElapsedNanos < duration ||
        value.observations.length >= value.requestedFrames))
  )
    throw new Error(
      "Frame pacing window does not match its original completion",
    );
  let previous = 0;
  for (const [index, frame] of value.observations.entries()) {
    if (
      frame.index !== index ||
      frame.elapsedNanos > value.measuredDurationNanos ||
      frame.intervalNanos !==
        (index === 0 ? 0 : frame.elapsedNanos - previous) ||
      (index > 0 && frame.intervalNanos <= 0)
    )
      throw new Error(
        "Frame pacing observations are reordered or their clock changed",
      );
    previous = frame.elapsedNanos;
  }
  if (
    JSON.stringify(value.runtime.code.map((entry) => entry.file)) !==
    JSON.stringify(wire.codeResources)
  )
    throw new Error("Frame pacing producer fingerprint inventory changed");
  const samples = value.observations
    .slice(1)
    .map((frame) => frame.intervalNanos)
    .sort((a, b) => a - b);
  const percentile = (p: number) =>
    samples[Math.ceil((samples.length * p) / 100) - 1];
  const expected = {
    intervals: samples.length,
    meanNanos:
      samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
    p50Nanos: percentile(50),
    p95Nanos: percentile(95),
    p99Nanos: percentile(99),
    maxNanos: samples.at(-1),
  };
  if (JSON.stringify(expected) !== JSON.stringify(value.quantiles))
    throw new Error(
      "Frame pacing quantiles differ from original render intervals",
    );
  return value;
}
