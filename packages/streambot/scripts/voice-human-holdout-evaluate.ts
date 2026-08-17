import path from "node:path";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { DiscordOpusEncoder } from "@shepherdjerred/discord-video-stream";
import { atomicWrite } from "@shepherdjerred/streambot/voice/corpus-io.ts";
import {
  cloneDiscordOpusPackets,
  evaluateDiscordOpusPackets,
} from "@shepherdjerred/streambot/voice/corpus-evaluator.ts";
import {
  initializeLocalVoiceModelsForRuntime,
  type LocalVoiceModels,
} from "@shepherdjerred/streambot/voice/local-models.ts";

const ClipSchema = z.strictObject({
  file: z.string().min(1),
  category: z.enum(["positive", "near-match", "background"]),
});
const SPEAKER_LABELS = ["speaker-1", "speaker-2", "speaker-3"] as const;
const InputSchema = z.strictObject({
  version: z.literal(1),
  // Three entries drawn from a three-label enum, all distinct, is exactly the required set.
  // Checking the labels individually would accept three `speaker-1` groups, and since the report
  // hardcodes `speakers: 3`, a single-speaker dataset could then pass the three-speaker gate.
  speakers: z
    .array(
      z.strictObject({
        label: z.enum(SPEAKER_LABELS),
        clips: z.array(ClipSchema).length(10),
      }),
    )
    .length(3)
    .refine(
      (speakers) =>
        new Set(speakers.map((speaker) => speaker.label)).size ===
        SPEAKER_LABELS.length,
      {
        message:
          "Human holdout must contain one group each for speaker-1, speaker-2, and speaker-3",
      },
    ),
});

function option(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? undefined : Bun.argv[index + 1];
}

async function rawFileToPackets(
  file: string,
  ffmpegPath: string,
): Promise<Uint8Array[]> {
  const child = Bun.spawn(
    [
      ffmpegPath,
      "-v",
      "error",
      "-i",
      file,
      "-af",
      "apad=pad_dur=2",
      "-f",
      "s16le",
      "-ac",
      "1",
      "-ar",
      "24000",
      "pipe:1",
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const pcm = new Uint8Array(await new Response(child.stdout).arrayBuffer());
  const stderr = await new Response(child.stderr).text();
  if ((await child.exited) !== 0) {
    throw new Error(`Human holdout conversion failed: ${stderr.trim()}`);
  }
  const encoder = new DiscordOpusEncoder();
  try {
    return [...encoder.encode(pcm), ...encoder.finish()];
  } finally {
    encoder.close();
    pcm.fill(0);
  }
}

const inputDir = path.resolve(z.string().min(1).parse(option("--input-dir")));
if (!inputDir.includes(`${path.sep}.context${path.sep}`)) {
  throw new Error(
    "Human holdout recordings must remain under a .context directory",
  );
}
const assetsDir = path.resolve(
  option("--assets-dir") ??
    Bun.env["VOICE_ASSETS_DIR"] ??
    "/opt/streambot/voice",
);
const reportPath = path.resolve(
  inputDir,
  "..",
  "streambot-human-holdout-result.json",
);
// Everything that reads the holdout runs inside this cleanup scope, because the privacy contract
// is that only the aggregate report outlives the run: a missing or malformed manifest, wrong
// category counts, a runtime that fails to initialize, a rejected clip, and a failed validation
// all have to delete the recordings. The `.context` guard above stays outside it — cleanup must
// never be armed for a path that was not established as a holdout directory. Runtimes open one at
// a time and register as they do, so a second failed initialization cannot strand the first.
const report = await (async () => {
  const opened: LocalVoiceModels[] = [];
  const openRuntime = async (
    runtime: "native" | "wasm",
  ): Promise<LocalVoiceModels> => {
    const models = await initializeLocalVoiceModelsForRuntime(
      assetsDir,
      runtime,
    );
    opened.push(models);
    return models;
  };
  try {
    const manifest = InputSchema.parse(
      await Bun.file(path.join(inputDir, "manifest.json")).json(),
    );
    for (const speaker of manifest.speakers) {
      const positives = speaker.clips.filter(
        (clip) => clip.category === "positive",
      ).length;
      const nearMatches = speaker.clips.filter(
        (clip) => clip.category === "near-match",
      ).length;
      const backgrounds = speaker.clips.filter(
        (clip) => clip.category === "background",
      ).length;
      if (positives !== 5 || nearMatches !== 3 || backgrounds !== 2) {
        throw new Error(
          `${speaker.label} must have five positives, three near-matches, and two background clips`,
        );
      }
    }
    // Thirty clips means thirty recordings: a manifest pointing several groups at the same
    // files would inflate the holdout's sample count without adding evidence.
    const clipPaths = manifest.speakers.flatMap((speaker) =>
      speaker.clips.map((clip) => clip.file),
    );
    if (new Set(clipPaths).size !== clipPaths.length) {
      throw new Error("Holdout clip paths must be distinct across all groups");
    }
    const native = await openRuntime("native");
    const wasm = await openRuntime("wasm");
    let positivePasses = 0;
    let negativePasses = 0;
    let identical = true;
    for (const speaker of manifest.speakers) {
      for (const clip of speaker.clips) {
        const absolute = path.resolve(inputDir, clip.file);
        if (!absolute.startsWith(`${inputDir}${path.sep}`)) {
          throw new Error("Human holdout clip escapes its input directory");
        }
        const packets = await rawFileToPackets(
          absolute,
          Bun.env["FFMPEG_PATH"] ?? "ffmpeg",
        );
        const nativePackets = cloneDiscordOpusPackets(packets);
        const wasmPackets = cloneDiscordOpusPackets(packets);
        const [nativeResult, wasmResult] = await (async () => {
          try {
            return await Promise.all([
              evaluateDiscordOpusPackets(native, nativePackets),
              evaluateDiscordOpusPackets(wasm, wasmPackets),
            ]);
          } finally {
            for (const packet of packets) packet.fill(0);
            for (const packet of nativePackets) packet.fill(0);
            for (const packet of wasmPackets) packet.fill(0);
          }
        })();
        identical &&= nativeResult.activated === wasmResult.activated;
        if (clip.category === "positive" && nativeResult.activated)
          positivePasses += 1;
        if (clip.category !== "positive" && !nativeResult.activated)
          negativePasses += 1;
      }
    }
    const aggregate = {
      version: 1,
      evaluatedAt: new Date().toISOString(),
      speakers: 3,
      positivePasses,
      positiveTotal: 15,
      negativePasses,
      negativeTotal: 15,
      identicalClassifications: identical,
      passed: positivePasses === 15 && negativePasses === 15 && identical,
    };
    await atomicWrite(reportPath, `${JSON.stringify(aggregate, null, 2)}\n`);
    return aggregate;
  } finally {
    // Deleting the recordings is the privacy contract, so it cannot be downstream of anything
    // that may reject. A failing ONNX session release must not keep private audio on disk.
    try {
      await Promise.all(opened.map((models) => models.close()));
    } finally {
      await rm(inputDir, { recursive: true });
    }
  }
})();
process.stdout.write(
  `${JSON.stringify(report, null, 2)}\nrecordings deleted after aggregate report: ${reportPath}\n`,
);
if (!report.passed)
  throw new Error("Human holdout acceptance thresholds failed");
