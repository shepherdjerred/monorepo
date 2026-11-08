import type { Annotation } from "#protocol/media.ts";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  DocsFramesSchema,
  PresentationSchema,
  PublicMediaSchema,
  type PublicMedia,
} from "#protocol/media.ts";
import { overlaySvg } from "#protocol/media-overlay.ts";
import { resolveAnnotations } from "./annotations.ts";
import { verifyVideo } from "./video-validation.ts";

async function execute(args: string[]): Promise<string> {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [out, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `${args[0] ?? "Encoder"} failed (${code.toString()}): ${error}`,
    );
  return out;
}

export async function sha256(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

/** Generates derivatives in a fresh directory. Originals are never rewritten. */
export async function renderMedia(
  source: string,
  presentationFile: string,
  destination: string,
): Promise<PublicMedia> {
  const presentation = PresentationSchema.parse(
    await Bun.file(presentationFile).json(),
  );
  await mkdir(destination, { recursive: false, mode: 0o700 });
  const video = source.endsWith(".json");
  const cues = presentation.annotations;
  const { width, height, annotations } = video
    ? await renderVideo(source, destination, cues)
    : await renderImage(source, destination, cues);
  const base = `/media/${presentation.name}`;
  const manifest = PublicMediaSchema.parse({
    schema: 1,
    name: presentation.name,
    kind: video ? "video" : "image",
    width,
    height,
    src: `${base}/${video ? "clip.mp4" : "original.webp"}`,
    poster: `${base}/poster.webp`,
    alt: presentation.alt,
    caption: presentation.caption,
    annotations,
  });
  await Bun.write(
    path.join(destination, "media.json"),
    JSON.stringify(manifest, null, 2),
  );
  await Bun.write(
    path.join(destination, "derivation.json"),
    JSON.stringify(
      {
        sourceSha256: await sha256(source),
        presentationSha256: await sha256(presentationFile),
        outputs: await Promise.all(
          [
            "media.json",
            "poster.webp",
            video ? "clip.mp4" : "original.webp",
            video ? "annotated.mp4" : "annotated.webp",
          ].map(async (file) => ({
            file,
            sha256: await sha256(path.join(destination, file)),
          })),
        ),
      },
      null,
      2,
    ),
  );
  return manifest;
}

async function renderVideo(
  source: string,
  destination: string,
  cues: readonly Annotation[],
) {
  const receipt = DocsFramesSchema.parse(await Bun.file(source).json());
  const resolved = resolveAnnotations(
    cues,
    receipt.markers,
    (receipt.requestedFrames * 1000) / 30,
  );
  const inputDir = path.dirname(source);
  const annotatedDir = path.join(destination, "annotated-frames");
  await mkdir(annotatedDir);
  const width = 1280;
  const height = 720;
  for (const entry of receipt.frames) {
    const original = path.join(inputDir, entry.file);
    if ((await sha256(original)) !== entry.sha256)
      throw new Error(`Source frame changed: ${entry.file}`);
    const metadata = await sharp(original).metadata();
    if (metadata.width !== width || metadata.height !== height)
      throw new Error("Source frame dimensions differ");
    const milliseconds = (entry.frame.index * 1000) / receipt.fps;
    await sharp(original)
      .composite([
        {
          input: Buffer.from(
            overlaySvg(
              resolved.filter(
                (cue) =>
                  cue.startMs <= milliseconds && cue.endMs > milliseconds,
              ),
              width,
              height,
            ),
          ),
        },
      ])
      .png()
      .toFile(path.join(annotatedDir, entry.file));
  }
  for (const [input, output] of [
    [inputDir, "clip.mp4"],
    [annotatedDir, "annotated.mp4"],
  ]) {
    if (input === undefined || output === undefined)
      throw new Error("Missing encoding path");
    await execute([
      "ffmpeg",
      "-v",
      "error",
      "-nostdin",
      "-n",
      "-framerate",
      "30",
      "-i",
      path.join(input, "%06d.png"),
      "-frames:v",
      receipt.requestedFrames.toString(),
      "-an",
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "2",
      path.join(destination, output),
    ]);
    const probe = await execute([
      "ffprobe",
      "-v",
      "error",
      "-count_frames",
      "-show_streams",
      "-of",
      "json",
      path.join(destination, output),
    ]);
    verifyVideo(JSON.parse(probe), receipt.requestedFrames);
  }
  const first = receipt.frames[0];
  if (first === undefined) throw new Error("Missing poster frame");
  await sharp(path.join(inputDir, first.file))
    .webp({ quality: 90 })
    .toFile(path.join(destination, "poster.webp"));
  for (const entry of receipt.frames)
    if ((await sha256(path.join(inputDir, entry.file))) !== entry.sha256)
      throw new Error("Source changed during encoding");

  return { width, height, annotations: resolved };
}
async function renderImage(
  source: string,
  destination: string,
  cues: readonly Annotation[],
) {
  if (cues.some((cue) => cue.atStep !== undefined))
    throw new Error("Step annotations require a recorded clip");
  const metadata = await sharp(source).metadata();
  if (metadata.width <= 0 || metadata.height <= 0)
    throw new Error("Missing image dimensions");
  const width = metadata.width;
  const height = metadata.height;
  await sharp(source)
    .webp({ quality: 90 })
    .toFile(path.join(destination, "original.webp"));
  await sharp(source)
    .webp({ quality: 90 })
    .toFile(path.join(destination, "poster.webp"));
  await sharp(source)
    .composite([{ input: Buffer.from(overlaySvg(cues, width, height)) }])
    .webp({ quality: 90 })
    .toFile(path.join(destination, "annotated.webp"));

  return { width, height, annotations: cues };
}
