import path from "node:path";
import { readdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DiscordOpusEncoder } from "@shepherdjerred/discord-video-stream";
import { evaluateDiscordOpusPackets } from "@shepherdjerred/streambot/voice/corpus-evaluator.ts";
import {
  initializeLocalVoiceModelsForRuntime,
  validateVoiceAssets,
  type LocalVoiceModels,
} from "@shepherdjerred/streambot/voice/local-models.ts";

const AUDIO_EXTENSIONS = new Set([
  ".aac",
  ".aif",
  ".aiff",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".opus",
  ".wav",
]);

type ExpectedWake = "wake" | "no-wake";

type Trial = {
  readonly expected: ExpectedWake;
  readonly file: string;
};

type RuntimeResult = {
  readonly runtime: LocalVoiceModels["runtime"];
  readonly positivePasses: number;
  readonly positiveTotal: number;
  readonly negativePasses: number;
  readonly negativeTotal: number;
  readonly candidatePositive: number;
  readonly candidateNegative: number;
  readonly classifications: ReadonlyMap<string, boolean>;
};

const defaultAssetsDir = path.resolve(
  import.meta.dir,
  "../../../.context/streambot-voice-models",
);

const help = `Streambot saved-recording wake evaluator

Replays audio through FFmpeg -> production Discord Opus encoder/decoder ->
production wake/VAD lifecycle. It never contacts OpenAI and never modifies input files.

Usage:
  bun run voice:harness:evaluate --positive-dir <dir> [--negative-dir <dir>]

Options:
  --positive-dir <path>  Audio expected to contain "Hey Streambot"
  --negative-dir <path>  Audio expected not to activate
  --positive-pattern <r> Only include positive basenames matching this regular expression
  --negative-pattern <r> Only include negative basenames matching this regular expression
  --assets-dir <path>    Prepared model assets (default: ${defaultAssetsDir})
  --runtime <value>      native, wasm, or both (default: native)
  --require-perfect      Exit nonzero unless every expectation passes
  -h, --help             Show this help
`;

async function audioFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await audioFiles(absolute)));
    } else if (
      entry.isFile() &&
      AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      files.push(absolute);
    }
  }
  return files.toSorted();
}

function matchingFiles(
  files: readonly string[],
  pattern: string | undefined,
): readonly string[] {
  if (pattern === undefined) return files;
  const expression = new RegExp(pattern, "u");
  return files.filter((file) => expression.test(path.basename(file)));
}

async function requiredAudioFiles(
  directory: string,
  pattern: string | undefined,
): Promise<readonly string[]> {
  const files = matchingFiles(
    await audioFiles(path.resolve(directory)),
    pattern,
  );
  if (files.length === 0) {
    throw new Error(`No supported audio files found under ${directory}`);
  }
  return files;
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
  const [pcmBuffer, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Audio conversion failed for ${file}: ${stderr.trim()}`);
  }
  const pcm = new Uint8Array(pcmBuffer);
  const encoder = new DiscordOpusEncoder();
  try {
    return [...encoder.encode(pcm), ...encoder.finish()];
  } finally {
    encoder.close();
    pcm.fill(0);
  }
}

async function evaluateRuntime(
  models: LocalVoiceModels,
  trials: readonly Trial[],
  ffmpegPath: string,
): Promise<RuntimeResult> {
  let positivePasses = 0;
  let positiveTotal = 0;
  let negativePasses = 0;
  let negativeTotal = 0;
  let candidatePositive = 0;
  let candidateNegative = 0;
  const classifications = new Map<string, boolean>();
  for (const trial of trials) {
    const packets = await rawFileToPackets(trial.file, ffmpegPath);
    const result = await (async () => {
      try {
        return await evaluateDiscordOpusPackets(models, packets);
      } finally {
        for (const packet of packets) packet.fill(0);
      }
    })();
    classifications.set(trial.file, result.activated);
    const passed = result.activated === (trial.expected === "wake");
    if (trial.expected === "wake") {
      positiveTotal += 1;
      if (result.candidate) candidatePositive += 1;
      if (passed) positivePasses += 1;
    } else {
      negativeTotal += 1;
      if (result.candidate) candidateNegative += 1;
      if (passed) negativePasses += 1;
    }
    console.log(
      `${passed ? "PASS" : "FAIL"} [${models.runtime}] expected=${trial.expected} sherpa=${result.candidate ? "candidate" : "none"} local=${result.activated ? "pass" : "reject"} ${trial.file}`,
    );
  }
  return {
    runtime: models.runtime,
    positivePasses,
    positiveTotal,
    negativePasses,
    negativeTotal,
    candidatePositive,
    candidateNegative,
    classifications,
  };
}

function printSummary(result: RuntimeResult): void {
  const positiveRecall =
    result.positiveTotal === 0
      ? "n/a"
      : `${((result.positivePasses / result.positiveTotal) * 100).toFixed(1)}%`;
  const falseWakes = result.negativeTotal - result.negativePasses;
  console.log(
    `${result.runtime}: sherpa candidates positive=${String(result.candidatePositive)}/${String(result.positiveTotal)} negative=${String(result.candidateNegative)}/${String(result.negativeTotal)}; local positives ${String(result.positivePasses)}/${String(result.positiveTotal)} (${positiveRecall}); local negatives ${String(result.negativePasses)}/${String(result.negativeTotal)}; cloud candidates ${String(falseWakes)}`,
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "positive-dir": { type: "string" },
      "negative-dir": { type: "string" },
      "positive-pattern": { type: "string" },
      "negative-pattern": { type: "string" },
      "assets-dir": { type: "string" },
      runtime: { type: "string", default: "native" },
      "require-perfect": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log(help);
    return;
  }
  const positiveDir = values["positive-dir"];
  if (positiveDir === undefined) {
    throw new Error("--positive-dir is required");
  }
  const runtime = values.runtime;
  if (runtime !== "native" && runtime !== "wasm" && runtime !== "both") {
    throw new Error("--runtime must be native, wasm, or both");
  }
  const ffmpegPath = Bun.which("ffmpeg");
  if (ffmpegPath === null) throw new Error("FFmpeg is required");
  const assetsDir = path.resolve(values["assets-dir"] ?? defaultAssetsDir);
  await validateVoiceAssets(assetsDir);
  const positiveFiles = await requiredAudioFiles(
    positiveDir,
    values["positive-pattern"],
  );
  const negativeFiles =
    values["negative-dir"] === undefined
      ? []
      : await requiredAudioFiles(
          values["negative-dir"],
          values["negative-pattern"],
        );
  const trials: Trial[] = [
    ...positiveFiles.map((file) => ({ expected: "wake" as const, file })),
    ...negativeFiles.map((file) => ({ expected: "no-wake" as const, file })),
  ];
  console.log(
    `Evaluating ${String(positiveFiles.length)} positives and ${String(negativeFiles.length)} negatives; OpenAI will not be contacted.`,
  );
  const runtimes: readonly ("native" | "wasm")[] =
    runtime === "both"
      ? ["native", "wasm"]
      : runtime === "native"
        ? ["native"]
        : ["wasm"];
  const results: RuntimeResult[] = [];
  for (const selected of runtimes) {
    const models = await initializeLocalVoiceModelsForRuntime(
      assetsDir,
      selected,
    );
    try {
      results.push(await evaluateRuntime(models, trials, ffmpegPath));
    } finally {
      await models.close();
    }
  }
  for (const result of results) printSummary(result);
  if (results.length === 2) {
    const first = results[0];
    const second = results[1];
    if (first === undefined || second === undefined) {
      throw new Error("Both runtime evaluations were not produced");
    }
    const disagreements = trials.filter(
      (trial) =>
        first.classifications.get(trial.file) !==
        second.classifications.get(trial.file),
    );
    console.log(`Runtime disagreements: ${String(disagreements.length)}`);
  }
  const perfect = results.every(
    (result) =>
      result.positivePasses === result.positiveTotal &&
      result.negativePasses === result.negativeTotal,
  );
  if (!perfect && values["require-perfect"]) {
    throw new Error("Saved-recording wake expectations did not all pass");
  }
}

await main();
