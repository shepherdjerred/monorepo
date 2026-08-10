import path from "node:path";
import { rm } from "node:fs/promises";
import OpenAI from "openai";
import { DiscordOpusEncoder } from "@shepherdjerred/discord-video-stream";
import {
  VoiceCorpusManifestSchema,
  type VoiceCorpusEntry,
  type VoiceCorpusManifest,
} from "@shepherdjerred/streambot/voice/corpus-schema.ts";
import {
  atomicWrite,
  DEFAULT_VOICE_CORPUS_DIR,
  sha256,
} from "@shepherdjerred/streambot/voice/corpus-io.ts";
import {
  expandVoiceCorpusRecipes,
  type VoiceCorpusRecipe,
} from "@shepherdjerred/streambot/voice/corpus-recipes.ts";
import { encodeDiscordOpusContainer } from "@shepherdjerred/streambot/voice/discord-opus-container.ts";

const SAMPLE_RATE = 24_000;
const TRAILING_SILENCE_MS = 1800;

export type SyntheticTtsRequest = {
  readonly provider: "openai" | "apple";
  readonly model: string;
  readonly voice: string;
  readonly style: VoiceCorpusRecipe["style"];
  readonly rateWpm: number | null;
  readonly text: string;
};

export type SyntheticTtsClient = {
  synthesize: (request: SyntheticTtsRequest) => Promise<Uint8Array>;
};

function deliveryInstructions(style: SyntheticTtsRequest["style"]): string {
  switch (style) {
    case "neutral":
      return "Speak naturally in a neutral conversational voice.";
    case "quiet":
      return "Speak quietly but clearly, as if others nearby are sleeping.";
    case "hurried":
      return "Speak quickly and with mild urgency while remaining intelligible.";
    case "distant":
      return "Sound as if speaking from several meters away in a room.";
    case "hesitant":
      return "Speak hesitantly with brief natural pauses, without changing the words.";
  }
}

export class OpenAiSyntheticTtsClient implements SyntheticTtsClient {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async synthesize(request: SyntheticTtsRequest): Promise<Uint8Array> {
    if (request.provider !== "openai") {
      throw new Error("OpenAI TTS client received a non-OpenAI recipe");
    }
    const response = await this.client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: request.voice,
      input: request.text,
      instructions: deliveryInstructions(request.style),
      response_format: "pcm",
    });
    return new Uint8Array(await response.arrayBuffer());
  }
}

async function runProcess(
  command: string[],
  stdin: Uint8Array | null,
  description: string,
): Promise<Uint8Array> {
  const child = Bun.spawn(command, {
    stdin: stdin === null ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== null) {
    const sink = child.stdin;
    if (sink === undefined) throw new Error(`${description} has no stdin pipe`);
    await sink.write(stdin);
    await sink.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${description} failed: ${stderr.trim()}`);
  }
  return new Uint8Array(stdout);
}

export class AppleSyntheticTtsClient implements SyntheticTtsClient {
  constructor(private readonly ffmpegPath = "ffmpeg") {}

  async synthesize(request: SyntheticTtsRequest): Promise<Uint8Array> {
    if (request.provider !== "apple" || request.rateWpm === null) {
      throw new Error("Apple TTS client received an invalid Apple recipe");
    }
    const output = path.join(
      Bun.env["TMPDIR"] ?? "/tmp",
      `streambot-voice-${crypto.randomUUID()}.aiff`,
    );
    try {
      await runProcess(
        [
          "/usr/bin/say",
          "-v",
          request.voice,
          "-r",
          String(request.rateWpm),
          "-o",
          output,
          request.text,
        ],
        null,
        "Apple speech synthesis",
      );
      return await runProcess(
        [
          this.ffmpegPath,
          "-v",
          "error",
          "-i",
          output,
          "-f",
          "s16le",
          "-ac",
          "1",
          "-ar",
          String(SAMPLE_RATE),
          "pipe:1",
        ],
        null,
        "Apple speech conversion",
      );
    } finally {
      if (await Bun.file(output).exists()) await rm(output);
    }
  }
}

function proceduralTones(): Uint8Array {
  const durationSeconds = 8;
  const samples = SAMPLE_RATE * durationSeconds;
  const output = new Uint8Array(samples * 2);
  const view = new DataView(output.buffer);
  for (let index = 0; index < samples; index += 1) {
    const time = index / SAMPLE_RATE;
    const envelope = 0.35 + 0.15 * Math.sin(2 * Math.PI * 0.25 * time);
    const value =
      envelope *
      (0.55 * Math.sin(2 * Math.PI * 220 * time) +
        0.3 * Math.sin(2 * Math.PI * 330 * time) +
        0.15 * Math.sin(2 * Math.PI * 440 * time));
    view.setInt16(index * 2, Math.round(value * 12_000), true);
  }
  return output;
}

async function normalizePcm(
  pcm: Uint8Array,
  ffmpegPath: string,
): Promise<Uint8Array> {
  return await runProcess(
    [
      ffmpegPath,
      "-v",
      "error",
      "-f",
      "s16le",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-af",
      "highpass=f=60,lowpass=f=7600,loudnorm=I=-20:LRA=7:TP=-2",
      "-f",
      "s16le",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      "1",
      "pipe:1",
    ],
    pcm,
    "voice corpus normalization",
  );
}

function pcmSamples(pcm: Uint8Array): Int16Array {
  if (pcm.byteLength % 2 !== 0) throw new Error("PCM byte length must be even");
  const samples = new Int16Array(pcm.byteLength / 2);
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true);
  }
  return samples;
}

function samplesToPcm(samples: Int16Array): Uint8Array {
  const output = new Uint8Array(samples.length * 2);
  const view = new DataView(output.buffer);
  for (const [index, sample] of samples.entries()) {
    view.setInt16(index * 2, sample, true);
  }
  return output;
}

function mixOverlap(primary: Uint8Array, secondary: Uint8Array): Uint8Array {
  const first = pcmSamples(primary);
  const second = pcmSamples(secondary);
  const offset = Math.round(SAMPLE_RATE * 0.35);
  const result = new Int16Array(Math.max(first.length, second.length + offset));
  for (let index = 0; index < result.length; index += 1) {
    const a = first[index] ?? 0;
    const b = index >= offset ? (second[index - offset] ?? 0) : 0;
    result[index] = Math.max(
      -32_768,
      Math.min(32_767, Math.round(a * 0.7 + b * 0.7)),
    );
  }
  return samplesToPcm(result);
}

function addNoise(
  pcm: Uint8Array,
  snrDb: number,
  seedText: string,
): Uint8Array {
  const samples = pcmSamples(pcm);
  const signalPower =
    samples.reduce((total, sample) => total + sample * sample, 0) /
    Math.max(samples.length, 1);
  const noiseRms = Math.sqrt(signalPower / 10 ** (snrDb / 10));
  let seed = 2_166_136_261;
  for (const character of seedText) {
    seed ^= character.codePointAt(0) ?? 0;
    seed = Math.imul(seed, 16_777_619) >>> 0;
  }
  const result = new Int16Array(samples.length);
  for (const [index, sample] of samples.entries()) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    const noise = (seed / 0xff_ff_ff_ff) * 2 - 1;
    result[index] = Math.max(
      -32_768,
      Math.min(32_767, Math.round(sample + noise * noiseRms * Math.sqrt(3))),
    );
  }
  return samplesToPcm(result);
}

function addEcho(pcm: Uint8Array): Uint8Array {
  const samples = pcmSamples(pcm);
  const delay = Math.round(SAMPLE_RATE * 0.18);
  const result = new Int16Array(samples.length + delay);
  for (let index = 0; index < result.length; index += 1) {
    const direct = samples[index] ?? 0;
    const echo = index >= delay ? (samples[index - delay] ?? 0) * 0.35 : 0;
    result[index] = Math.max(
      -32_768,
      Math.min(32_767, Math.round(direct + echo)),
    );
  }
  return samplesToPcm(result);
}

function appendSilence(pcm: Uint8Array): Uint8Array {
  const silenceBytes =
    Math.round((TRAILING_SILENCE_MS / 1000) * SAMPLE_RATE) * 2;
  const output = new Uint8Array(pcm.byteLength + silenceBytes);
  output.set(pcm);
  return output;
}

function encodeOpus(pcm: Uint8Array): Uint8Array[] {
  const encoder = new DiscordOpusEncoder();
  try {
    return [...encoder.encode(pcm), ...encoder.finish()];
  } finally {
    encoder.close();
  }
}

function applyPacketLoss(packets: Uint8Array[], percent: number): Uint8Array[] {
  if (percent === 0) return packets;
  const silencePacket = encodeOpus(new Uint8Array((SAMPLE_RATE / 50) * 2))[0];
  if (silencePacket === undefined)
    throw new Error("Failed to encode Opus silence packet");
  const interval = Math.max(2, Math.round(100 / percent));
  return packets.map((packet, index) =>
    index > 3 && index % interval === 0 ? silencePacket : packet,
  );
}

function sameRecipe(
  entry: VoiceCorpusEntry,
  recipe: VoiceCorpusRecipe,
): boolean {
  return (
    JSON.stringify({
      ...entry,
      durationMs: undefined,
      speechEndMs: undefined,
      packetCount: undefined,
      sha256: undefined,
    }) === JSON.stringify(recipe)
  );
}

async function synthesizeRecipe(
  recipe: VoiceCorpusRecipe,
  clients: {
    readonly openai: SyntheticTtsClient;
    readonly apple: SyntheticTtsClient;
  },
): Promise<Uint8Array> {
  if (recipe.provider === "procedural") return proceduralTones();
  const client = recipe.provider === "openai" ? clients.openai : clients.apple;
  const request: SyntheticTtsRequest = {
    provider: recipe.provider,
    model: recipe.model,
    voice: recipe.voice,
    style: recipe.style,
    rateWpm: recipe.rateWpm,
    text: recipe.text,
  };
  if (!recipe.augmentation.overlap) return await client.synthesize(request);
  const sentences = recipe.text.split(". ");
  const first = sentences[0] ?? recipe.text;
  const second = sentences.slice(1).join(". ");
  const [primary, secondary] = await Promise.all([
    client.synthesize({ ...request, text: first }),
    client.synthesize({
      ...request,
      text: second.length === 0 ? first : second,
    }),
  ]);
  return mixOverlap(primary, secondary);
}

export type GenerateVoiceCorpusOptions = {
  readonly corpusDir?: string;
  readonly ffmpegPath?: string;
  readonly refresh?: boolean;
  readonly recipes?: readonly VoiceCorpusRecipe[];
  readonly normalize?: (pcm: Uint8Array) => Promise<Uint8Array>;
  readonly encode?: (pcm: Uint8Array) => Uint8Array[];
  readonly clients: {
    readonly openai: SyntheticTtsClient;
    readonly apple: SyntheticTtsClient;
  };
};

export async function generateVoiceCorpus(
  options: GenerateVoiceCorpusOptions,
): Promise<VoiceCorpusManifest> {
  const corpusDir = options.corpusDir ?? DEFAULT_VOICE_CORPUS_DIR;
  const manifestPath = path.join(corpusDir, "manifest.json");
  const existingFile = Bun.file(manifestPath);
  const existing = (await existingFile.exists())
    ? VoiceCorpusManifestSchema.parse(await existingFile.json())
    : VoiceCorpusManifestSchema.parse({
        version: 1,
        format: "streambot-discord-opus-v1",
        disclosure:
          "AI-generated and procedurally generated speech/audio; no recordings of people or copyrighted media.",
        entries: [],
      });
  const entries = new Map(existing.entries.map((entry) => [entry.id, entry]));
  for (const recipe of options.recipes ?? expandVoiceCorpusRecipes()) {
    const destination = path.join(corpusDir, recipe.file);
    const previous = entries.get(recipe.id);
    if (
      previous !== undefined &&
      (await Bun.file(destination).exists()) &&
      options.refresh !== true
    ) {
      if (!sameRecipe(previous, recipe)) {
        throw new Error(
          `Canonical recipe changed for ${recipe.id}; pass --refresh to replace it`,
        );
      }
      continue;
    }
    if ((await Bun.file(destination).exists()) && options.refresh !== true) {
      throw new Error(
        `Canonical fixture exists without a manifest entry: ${recipe.file}`,
      );
    }
    let pcm = await synthesizeRecipe(recipe, options.clients);
    pcm =
      options.normalize === undefined
        ? await normalizePcm(pcm, options.ffmpegPath ?? "ffmpeg")
        : await options.normalize(pcm);
    if (recipe.augmentation.echo) pcm = addEcho(pcm);
    if (recipe.augmentation.snrDb !== null) {
      pcm = addNoise(pcm, recipe.augmentation.snrDb, recipe.id);
    }
    const speechEndMs = Math.round((pcm.byteLength / 2 / SAMPLE_RATE) * 1000);
    const packets = applyPacketLoss(
      (options.encode ?? encodeOpus)(appendSilence(pcm)),
      recipe.augmentation.packetLossPercent,
    );
    const container = encodeDiscordOpusContainer(packets);
    await atomicWrite(destination, container);
    entries.set(recipe.id, {
      ...recipe,
      durationMs: packets.length * 20,
      speechEndMs: recipe.provider === "procedural" ? null : speechEndMs,
      packetCount: packets.length,
      sha256: sha256(container),
    });
    const manifest = VoiceCorpusManifestSchema.parse({
      ...existing,
      entries: [...entries.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    });
    await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return VoiceCorpusManifestSchema.parse(await Bun.file(manifestPath).json());
}
