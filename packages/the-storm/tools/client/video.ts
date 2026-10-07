import { createHash } from "node:crypto";
import { lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import contract from "#learning/preference/contract.json";
import { run } from "#learning/preference/media.ts";
import { validateFrames } from "./video-frames.ts";
import type { FrameReceipt } from "./video-frames.ts";
import { validateDuelFrames } from "./duel-video.ts";
import type { DuelFrameReceipt } from "./duel-video.ts";

type RenderedReceipt = FrameReceipt | DuelFrameReceipt;
async function digest(file: string): Promise<string> {
  const stat = await lstat(file);
  if (!stat.isFile()) throw new Error("Frame evidence must be a regular file");
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(file).stream()) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyFrames(
  directory: string,
  receipt: RenderedReceipt,
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

async function verifyVideo(
  file: string,
  receipt: RenderedReceipt,
): Promise<void> {
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
  const raw: unknown = await Bun.file(source).json();
  const identity = z
    .object({ schema: z.union([z.literal(1), z.literal(2)]) })
    .parse(raw);
  const receipt =
    identity.schema === 2 ? validateDuelFrames(raw) : validateFrames(raw);
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
    native_window_bound: receipt.schema === 2,
  };
  await writeFile(
    path.join(directory, "video.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { flag: "wx" },
  );
  return result;
}
