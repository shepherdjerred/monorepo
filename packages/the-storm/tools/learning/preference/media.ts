import path from "node:path";
import { z } from "zod";
import contract from "./contract.json";

export async function run(argv: string[]) {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
  }, 60_000);
  try {
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    // ffmpeg can return zero for errors such as an existing -n target. Its
    // media calls use error-only logging, so those messages are failures too.
    if (
      status !== 0 ||
      (["ffmpeg", "ffprobe"].includes(argv[0] ?? "") && stderr.trim() !== "")
    )
      throw new Error(
        `${argv[0] ?? "subprocess"} failed (${status.toString()}): ${stderr}`,
      );
    return stdout;
  } finally {
    clearTimeout(timer);
  }
}

const Probe = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      avg_frame_rate: z.string().optional(),
      nb_read_frames: z.string().optional(),
    }),
  ),
  format: z.object({ duration: z.string() }),
});

export async function validateVideo(file: string) {
  const raw: unknown = JSON.parse(
    await run([
      "ffprobe",
      "-v",
      "error",
      "-count_frames",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      path.resolve(file),
    ]),
  );
  const probe = Probe.parse(raw);
  const videos = probe.streams.filter(
    (stream) => stream.codec_type === "video",
  );
  const video = videos[0];
  if (
    videos.length !== 1 ||
    video?.width !== contract.video.width ||
    video.height !== contract.video.height ||
    video.avg_frame_rate !== `${contract.video.fps.toString()}/1` ||
    video.nb_read_frames !==
      (contract.video.fps * contract.video.seconds).toString() ||
    Math.abs(Number(probe.format.duration) - contract.video.seconds) >
      1 / contract.video.fps ||
    !Number.isFinite(Number(probe.format.duration))
  )
    throw new Error("blind review needs one 1280x720, 30 fps, 30-second video");
}

/** Re-encode once, stripping audio, container tags, chapters and extra streams. */
export async function blindVideo(input: string, output: string) {
  await validateVideo(input);
  await run([
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-n",
    "-i",
    path.resolve(input),
    "-map",
    "0:v:0",
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
    path.resolve(output),
  ]);
  await validateVideo(output);
}
