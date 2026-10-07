import { createHash } from "node:crypto";
import { lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import contract from "#learning/preference/contract.json";
import { run } from "#learning/preference/media.ts";
import wire from "#client-video-wire";

const Camera = z.strictObject({
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

/** Every live slot must contain a separately rendered frame with the same observed camera. */
export function validateFrames(raw: unknown): FrameReceipt {
  const receipt = FrameReceipt.parse(raw);
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
  return receipt;
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

async function digest(file: string): Promise<string> {
  const stat = await lstat(file);
  if (!stat.isFile()) throw new Error("Frame evidence must be a regular file");
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(file).stream()) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyFrames(
  directory: string,
  receipt: FrameReceipt,
): Promise<void> {
  for (const frame of receipt.frames)
    if ((await digest(path.join(directory, frame.file))) !== frame.sha256)
      throw new Error(`Rendered frame hash changed: ${frame.file}`);
}

const Probe = z.object({
  streams: z
    .array(
      z.object({
        codec_type: z.literal("video"),
        width: z.literal(contract.video.width),
        height: z.literal(contract.video.height),
        avg_frame_rate: z.literal("30/1"),
        nb_read_frames: z.string(),
      }),
    )
    .length(1),
  format: z.object({ duration: z.string() }),
});

async function verifyVideo(file: string, receipt: FrameReceipt): Promise<void> {
  const probe = Probe.parse(
    JSON.parse(
      await run([
        "ffprobe",
        "-v",
        "error",
        "-count_frames",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        file,
      ]),
    ),
  );
  const duration = Number(probe.format.duration);
  if (
    probe.streams[0]?.nb_read_frames !== receipt.requestedFrames.toString() ||
    !Number.isFinite(duration) ||
    Math.abs(duration - receipt.requestedFrames / receipt.fps) > 1 / receipt.fps
  )
    throw new Error("Encoded video differs from the rendered frame inventory");
}

/** No overwrite, no audio, no synthetic catch-up frames. Original PNGs and receipts remain. */
export async function encodeVideo(receiptFile: string) {
  const source = path.resolve(receiptFile);
  const receiptHash = await digest(source);
  const receipt = validateFrames(await Bun.file(source).json());
  const directory = path.dirname(source);
  await verifyFrames(directory, receipt);
  const output = path.join(directory, "clip.mp4");
  await writeFile(
    path.join(directory, "encoding.claimed.json"),
    `${JSON.stringify({ schema: 1, receipt_sha256: receiptHash })}\n`,
    { flag: "wx" },
  );
  await run([
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-n",
    "-framerate",
    receipt.fps.toString(),
    "-start_number",
    "0",
    "-i",
    path.join(directory, "%06d.png"),
    "-frames:v",
    receipt.requestedFrames.toString(),
    "-an",
    "-sn",
    "-dn",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "2",
    output,
  ]);
  await verifyVideo(output, receipt);
  await verifyFrames(directory, receipt);
  if ((await digest(source)) !== receiptHash)
    throw new Error("Rendered frame receipt changed during encoding");
  const result = {
    schema: 1,
    kind: "rwf-rendered-video",
    acceptance: "unaccepted",
    receipt_sha256: receiptHash,
    video_sha256: await digest(output),
    video: output,
    frames: receipt.requestedFrames,
    fps: receipt.fps,
  };
  await writeFile(
    path.join(directory, "video.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { flag: "wx" },
  );
  return result;
}
