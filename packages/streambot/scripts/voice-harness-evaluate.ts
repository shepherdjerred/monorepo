import path from "node:path";
import { readdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  DiscordOpusEncoder,
  type LocalVoiceModels,
} from "@shepherdjerred/voice-assistant";
import {
  initializeLocalVoiceModelsForRuntime,
  validateVoiceAssets,
} from "@shepherdjerred/voice-assistant/local-models.ts";
import {
  evaluateDiscordOpusPackets,
  runContinuousActivationSoak,
  type SoakActivation,
  type VoiceLifecycleDeps,
} from "@shepherdjerred/streambot/voice/corpus-evaluator.ts";
import {
  resolveVoiceWakePhrase,
  type VoiceWakePhraseProfile,
} from "@shepherdjerred/streambot/voice/corpus-phrases.ts";
import { streambotVoiceLifecycleDeps } from "@shepherdjerred/streambot/voice/local-voice.ts";

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

const help = `Saved-recording wake evaluator

Replays audio through FFmpeg -> production Discord Opus encoder/decoder ->
production wake/VAD lifecycle. It never contacts OpenAI and never modifies input files.

Usage:
  bun run voice:harness:evaluate --positive-dir <dir> [--negative-dir <dir>]
  bun run voice:harness:evaluate --soak <audio-file> [--soak-duration-hours <n>]

Options:
  --phrase <value>       hey-streambot or hey-scout (default: hey-streambot)
  --positive-dir <path>  Audio expected to contain the wake phrase
  --negative-dir <path>  Audio expected not to activate
  --positive-pattern <r> Only include positive basenames matching this regular expression
  --negative-pattern <r> Only include negative basenames matching this regular expression
  --soak <path>          Continuous-session mode: feed one real audio file through a single,
                         never-reset lifecycle for --soak-duration-hours (looping the file if
                         shorter), reporting every false-wake timestamp. Mutually exclusive with
                         --positive-dir/--negative-dir.
  --soak-duration-hours  Target soak duration in hours (default: 2)
  --assets-dir <path>    Prepared model assets (default: the phrase's own default)
  --runtime <value>      native, wasm, or both (default: native)
  --require-perfect      Exit nonzero unless every expectation passes (positive/negative mode only)
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
  lifecycleDeps: VoiceLifecycleDeps,
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
        return await evaluateDiscordOpusPackets(models, packets, lifecycleDeps);
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

async function runSoak(
  models: LocalVoiceModels,
  options: {
    readonly audioFile: string;
    readonly ffmpegPath: string;
    readonly lifecycleDeps: VoiceLifecycleDeps;
    readonly targetMs: number;
  },
): Promise<readonly SoakActivation[]> {
  const packets = await rawFileToPackets(options.audioFile, options.ffmpegPath);
  try {
    return await runContinuousActivationSoak(
      models,
      packets,
      options.lifecycleDeps,
      options.targetMs,
    );
  } finally {
    for (const packet of packets) packet.fill(0);
  }
}

function printSoakSummary(
  runtime: LocalVoiceModels["runtime"],
  activations: readonly SoakActivation[],
  targetMs: number,
): void {
  console.log(
    `${runtime}: ${String(activations.length)} false wake(s) over ${(targetMs / 3_600_000).toFixed(2)}h`,
  );
  for (const activation of activations) {
    const totalSeconds = Math.round(activation.elapsedMs / 1000);
    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    console.log(`  ${runtime}: false wake at ${hh}:${mm}:${ss}`);
  }
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

async function buildLifecycleDeps(
  phrase: VoiceWakePhraseProfile,
): Promise<VoiceLifecycleDeps> {
  return {
    ...streambotVoiceLifecycleDeps(),
    fragmentTailMs: await phrase.loadFragmentTailMs(),
  };
}

type SharedContext = {
  readonly assetManifest: ReturnType<VoiceWakePhraseProfile["assetManifest"]>;
  readonly lifecycleDeps: VoiceLifecycleDeps;
  readonly ffmpegPath: string;
  readonly phrase: VoiceWakePhraseProfile;
  readonly runtimes: readonly ("native" | "wasm")[];
};

async function runSoakMode(
  context: SharedContext,
  soakFile: string,
  soakDurationHoursText: string,
): Promise<void> {
  const soakHours = Number(soakDurationHoursText);
  if (!Number.isFinite(soakHours) || soakHours <= 0) {
    throw new Error("--soak-duration-hours must be a positive number");
  }
  const targetMs = soakHours * 3_600_000;
  console.log(
    `Soaking ${path.resolve(soakFile)} for ${soakHours.toString()}h against ${context.phrase.slug}; OpenAI will not be contacted.`,
  );
  for (const selected of context.runtimes) {
    const models = await initializeLocalVoiceModelsForRuntime(
      context.assetManifest,
      selected,
    );
    try {
      const activations = await runSoak(models, {
        audioFile: soakFile,
        ffmpegPath: context.ffmpegPath,
        lifecycleDeps: context.lifecycleDeps,
        targetMs,
      });
      printSoakSummary(models.runtime, activations, targetMs);
    } finally {
      await models.close();
    }
  }
}

async function runPositiveNegativeMode(
  context: SharedContext,
  values: {
    readonly "positive-dir"?: string;
    readonly "negative-dir"?: string;
    readonly "positive-pattern"?: string;
    readonly "negative-pattern"?: string;
    readonly "require-perfect": boolean;
  },
): Promise<void> {
  const positiveDir = values["positive-dir"];
  if (positiveDir === undefined) {
    throw new Error("--positive-dir is required (or use --soak)");
  }
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
    `Evaluating ${String(positiveFiles.length)} positives and ${String(negativeFiles.length)} negatives against ${context.phrase.slug}; OpenAI will not be contacted.`,
  );
  const results: RuntimeResult[] = [];
  for (const selected of context.runtimes) {
    const models = await initializeLocalVoiceModelsForRuntime(
      context.assetManifest,
      selected,
    );
    try {
      results.push(
        await evaluateRuntime(
          models,
          trials,
          context.ffmpegPath,
          context.lifecycleDeps,
        ),
      );
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

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      phrase: { type: "string" },
      "positive-dir": { type: "string" },
      "negative-dir": { type: "string" },
      "positive-pattern": { type: "string" },
      "negative-pattern": { type: "string" },
      soak: { type: "string" },
      "soak-duration-hours": { type: "string", default: "2" },
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
  const runtime = values.runtime;
  if (runtime !== "native" && runtime !== "wasm" && runtime !== "both") {
    throw new Error("--runtime must be native, wasm, or both");
  }
  const ffmpegPath = Bun.which("ffmpeg");
  if (ffmpegPath === null) throw new Error("FFmpeg is required");
  const phrase = resolveVoiceWakePhrase(values.phrase);
  const assetsDir = path.resolve(
    values["assets-dir"] ?? phrase.defaultAssetsDir,
  );
  const assetManifest = phrase.assetManifest(assetsDir);
  await validateVoiceAssets(assetManifest);
  const context: SharedContext = {
    assetManifest,
    lifecycleDeps: await buildLifecycleDeps(phrase),
    ffmpegPath,
    phrase,
    runtimes:
      runtime === "both"
        ? ["native", "wasm"]
        : runtime === "native"
          ? ["native"]
          : ["wasm"],
  };

  const soakFile = values.soak;
  if (soakFile !== undefined) {
    if (
      values["positive-dir"] !== undefined ||
      values["negative-dir"] !== undefined
    ) {
      throw new Error(
        "--soak is mutually exclusive with --positive-dir/--negative-dir",
      );
    }
    await runSoakMode(context, soakFile, values["soak-duration-hours"]);
    return;
  }

  await runPositiveNegativeMode(context, values);
}

await main();
