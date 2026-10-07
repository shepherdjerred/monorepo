import { z } from "zod";
import wire from "#client-video-wire";

export const Camera = z.strictObject({
  position: z.tuple([z.number(), z.number(), z.number()]),
  yaw: z.number(),
  pitch: z.number().min(-90).max(90),
  fov: z.number().min(30).max(110),
  hud: z.literal(false),
  nameplates: z.literal(false),
});

export const FrameReceipt = z.strictObject({
  schema: z.literal(1),
  kind: z.literal("rwf-rendered-frames"),
  acceptance: z.literal("unaccepted"),
  source: z.literal("minecraft-framebuffer"),
  fps: z.literal(30),
  requestedFrames: z.number().int().min(1).max(1800),
  complete: z.literal(true),
  error: z.literal(""),
  frames: z
    .array(
      z.strictObject({
        frame: z.strictObject({
          index: z.number().int().nonnegative(),
          elapsedNanos: z.number().int().nonnegative(),
          worldTick: z.number().int().nonnegative(),
          camera: Camera,
        }),
        file: z.string().regex(/^\d{6}\.png$/u),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
    )
    .min(1)
    .max(1800),
});
export type FrameReceipt = z.infer<typeof FrameReceipt>;

export const VideoStatus = z.strictObject({
  name: z.string().min(1),
  state: z.enum([
    "STARTING",
    "ARMING",
    "READY",
    "CAPTURING",
    "DRAINING",
    "COMPLETE",
    "FAILED",
  ]),
  captured: z.number().int().nonnegative(),
  total: z.number().int().min(1).max(1800),
  error: z.string(),
  receipt: z.string().min(1),
});

if (
  JSON.stringify(wire) !==
  JSON.stringify({
    version: 1,
    video: {
      width: 1280,
      height: 720,
      fps: 30,
      maximumFrames: 1800,
      pendingImages: 8,
    },
    source: "minecraft-framebuffer",
    cameraTolerance: { position: 0.000001, degrees: 0.0001 },
    kind: "rwf-rendered-frames",
    status: Object.keys(VideoStatus.shape),
    receipt: Object.keys(FrameReceipt.shape),
    written: ["frame", "file", "sha256"],
    frame: ["index", "elapsedNanos", "worldTick", "camera"],
    camera: Object.keys(Camera.shape),
  })
)
  throw new Error("Unsupported rendered capture wire contract");

export function validateFrames(raw: unknown): FrameReceipt {
  const receipt = FrameReceipt.parse(raw);
  validateFrameInventory(receipt);
  return receipt;
}

/** Shared pixel, camera and slot checks for ordinary and native-window receipts. */
export function validateFrameInventory(
  receipt: Pick<FrameReceipt, "frames" | "requestedFrames" | "fps">,
): void {
  if (receipt.frames.length !== receipt.requestedFrames)
    throw new Error("Rendered frame inventory is incomplete");
  const camera = receipt.frames[0]?.frame.camera;
  if (camera === undefined) throw new Error("Rendered camera is missing");
  let lastTick = -1;
  receipt.frames.forEach(({ frame, file }, index) => {
    if (
      frame.index !== index ||
      file !== `${index.toString().padStart(6, "0")}.png`
    )
      throw new Error("Rendered frame inventory is reordered or duplicated");
    const due = Math.floor((index * 1_000_000_000) / receipt.fps);
    const end = Math.floor(((index + 1) * 1_000_000_000) / receipt.fps);
    if (frame.elapsedNanos < due || frame.elapsedNanos >= end)
      throw new Error("Rendered frame missed its live sampling slot");
    if (frame.worldTick < lastTick || !sameCamera(camera, frame.camera))
      throw new Error("Rendered world clock or camera changed");
    lastTick = frame.worldTick;
  });
}

function sameCamera(
  first: z.infer<typeof Camera>,
  next: z.infer<typeof Camera>,
): boolean {
  return (
    first.position.every(
      (value, index) =>
        Math.abs(value - (next.position[index] ?? Infinity)) <=
        wire.cameraTolerance.position,
    ) &&
    Math.abs(first.yaw - next.yaw) <= wire.cameraTolerance.degrees &&
    Math.abs(first.pitch - next.pitch) <= wire.cameraTolerance.degrees &&
    Math.abs(first.fov - next.fov) <= wire.cameraTolerance.degrees
  );
}
