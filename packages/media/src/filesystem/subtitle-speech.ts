import nodePath from "node:path";
import {
  mkdtemp,
  writeFile,
  unlink,
  rmdir,
  realpath,
  lstat,
  readFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { subtitleCues } from "#integrations/subtitle-dialogue.ts";
import { SubtitleSpeechProofSchema } from "#domain/subtitle-speech.ts";
import {
  runMediaTool,
  MediaToolError,
  type RunMediaTool,
} from "./media-tools.ts";
import { validateSubtitle } from "#integrations/subtitle-validation.ts";

/** The video is independently identity-guarded by the Files caller throughout measurement. */
export async function measureSubtitleSpeech(
  input: {
    videoPath: string;
    controlRoot: string;
    text: string;
    format: "srt" | "ass" | "ssa" | "vtt";
    runtimeMs: number;
    videoChecksum: string;
    subtitleChecksum: string;
    synchronize?: boolean;
    requireSimplified?: boolean;
    signal: AbortSignal;
    checkpoint: () => Promise<void>;
  },
  run: RunMediaTool = runMediaTool,
) {
  input.signal.throwIfAborted();
  z.int().positive().max(28_800_000).parse(input.runtimeMs);
  if (
    createHash("sha256").update(input.text).digest("hex") !==
    input.subtitleChecksum
  )
    throw new Error("Subtitle source checksum changed");
  if ((await realpath(input.controlRoot)) !== input.controlRoot)
    throw new Error("Subtitle control root is not real");
  const directory = await mkdtemp(
    nodePath.join(input.controlRoot, "caption-speech-"),
  );
  const cuePath = nodePath.join(directory, "cues.json");
  const reference = nodePath.join(directory, "speech.npz");
  const source = nodePath.join(directory, `original.${input.format}`);
  const output = nodePath.join(directory, `synchronized.${input.format}`);
  const options = {
    maxBytes: 16_384,
    timeoutMs: 1_800_000,
    signal: input.signal,
    checkpoint: input.checkpoint,
  };
  try {
    await run(
      "media-subtitle-analysis",
      ["audio", input.videoPath, reference, String(input.runtimeMs)],
      options,
    );
    let text = input.text;
    if (input.synchronize === true) {
      if (input.format === "vtt")
        throw new Error(
          "Subtitle timing requires a supported ffsubsync text format",
        );
      await writeFile(source, text, { flag: "wx", mode: 0o600 });
      await run(
        "ffsubsync",
        [
          reference,
          "-i",
          source,
          "-o",
          output,
          "--encoding",
          "utf8",
          "--output-encoding",
          "utf8",
          "--max-offset-seconds",
          // ffsubsync's FFT mask must stay within the reference support on
          // short clips; sixty seconds remains the household upper bound.
          String(Math.min(60, input.runtimeMs / 2000)),
          "--gss",
          "--no-fix-framerate",
        ],
        options,
      );
      const stat = await lstat(output);
      if (
        !stat.isFile() ||
        stat.size > 8 * 1024 * 1024 ||
        (await realpath(output)) !== output
      )
        throw new Error("Invalid synchronized subtitle output");
      text = validateSubtitle({
        bytes: await readFile(output),
        filename: `caption.${input.format}`,
        provenanceText: "",
        requireSimplified: input.requireSimplified === true,
      }).text;
    }
    const checksum = createHash("sha256").update(text).digest("hex");
    const cues = subtitleCues(text, input.format).map((c) => [c.start, c.end]);
    await writeFile(cuePath, JSON.stringify(cues), { flag: "wx", mode: 0o600 });
    const bytes = await run(
      "media-subtitle-analysis",
      ["coverage", reference, cuePath, String(input.runtimeMs)],
      options,
    );
    const measurement = z
      .strictObject({
        speechMs: z.int().nonnegative(),
        coveredSpeechMs: z.int().nonnegative(),
        windows: SubtitleSpeechProofSchema.shape.windows,
      })
      .parse(JSON.parse(new TextDecoder().decode(bytes)));
    if (measurement.speechMs === 0)
      throw new MediaToolError("media-subtitle-analysis", "failed");
    return {
      text,
      checksum,
      proof: SubtitleSpeechProofSchema.parse({
        ...measurement,
        schemaVersion: 1,
        detector: "ffsubsync-0.5.1/webrtc",
        videoChecksum: input.videoChecksum,
        subtitleChecksum: checksum,
        runtimeMs: input.runtimeMs,
      }),
    };
  } finally {
    for (const file of [cuePath, reference, source, output])
      await unlink(file).catch((error: unknown) => {
        if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
          throw error;
      });
    await rmdir(directory);
  }
}
