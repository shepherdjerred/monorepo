import path from "node:path";
import { Client } from "discord.js-selfbot-v13";
import {
  DiscordOpusDecoder,
  DiscordOpusEncoder,
  Streamer,
} from "@shepherdjerred/discord-video-stream";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import type { ChannelId } from "@shepherdjerred/streambot/types/ids.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { loadVoiceCorpusManifest } from "@shepherdjerred/streambot/voice/corpus-io.ts";
import { decodeDiscordOpusContainer } from "@shepherdjerred/streambot/voice/discord-opus-container.ts";
import {
  CLOUD_VERIFICATION_MAX_ATTEMPTS,
  CLOUD_VERIFICATION_WINDOW_MS,
} from "@shepherdjerred/streambot/voice/cloud-verification-rate-limiter.ts";
export const BASELINE_CLIP = "/tmp/streambot-voice-assistant-baseline.mp4";
export const LOCAL_CLIP = "/tmp/streambot-voice-assistant-local.mp4";
export const CORPUS_DIR = path.resolve(
  import.meta.dir,
  "../test/fixtures/voice-corpus",
);
const CLOUD_VERIFICATION_PACING_MS =
  Math.ceil(CLOUD_VERIFICATION_WINDOW_MS / CLOUD_VERIFICATION_MAX_ATTEMPTS) +
  100;
const nextCloudVerificationAt = new Map<string, number>();
type WebRtcConnection = Awaited<ReturnType<Streamer["joinVoice"]>>;
export type Speaker = {
  readonly client: Client;
  readonly streamer: Streamer;
  readonly connection: WebRtcConnection;
  readonly packetsFrom: (userId: string) => readonly Uint8Array[];
  readonly moveTo: (guildId: string, channelId: ChannelId) => Promise<void>;
  readonly voiceSessionKey: string;
  readonly userId: string;
};
export async function paceCloudVerification(speaker: Speaker): Promise<void> {
  const nowMs = Date.now();
  const reservedAtMs = Math.max(
    nowMs,
    nextCloudVerificationAt.get(speaker.voiceSessionKey) ?? nowMs,
  );
  nextCloudVerificationAt.set(
    speaker.voiceSessionKey,
    reservedAtMs + CLOUD_VERIFICATION_PACING_MS,
  );
  if (reservedAtMs > nowMs) await Bun.sleep(reservedAtMs - nowMs);
}
export type VoiceMetricSnapshot = {
  readonly candidates: number;
  readonly localAccepted: number;
  readonly localRejected: number;
  readonly transcriptAccepted: number;
  readonly transcriptRejected: number;
  readonly cloudRateLimited: number;
  readonly transcriptionInputTokens: number;
  readonly transcriptionOutputTokens: number;
  readonly transcriptionInputSeconds: number;
  readonly wakes: number;
  readonly commandTurns: number;
  readonly deniedTools: number;
  readonly successfulTools: number;
  readonly replyPackets: number;
  readonly ducked: number;
  readonly restored: number;
  readonly failures: number;
  readonly audioTokens: number;
  readonly repliesWithinTenSeconds: number;
  readonly wakeToReplyCount: number;
  readonly ffmpegOutSeconds: number;
  readonly concurrentTurns: number;
};

export function requiredList(name: string): string[] {
  const values = Bun.env[name]
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values === undefined || values.length < 2) {
    throw new Error(`${name} must contain two comma-separated values`);
  }
  return values;
}

export function firstTwo<T>(
  values: readonly T[],
  label: string,
): readonly [T, T] {
  const first = values[0];
  const second = values[1];
  if (first === undefined || second === undefined) {
    throw new Error(`${label} requires two values`);
  }
  return [first, second];
}

async function run(command: string[], description: string): Promise<void> {
  const process = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${description} failed: ${stderr.trim()}`);
  }
}

export async function generateClip(
  ffmpegPath: string,
  output: string,
): Promise<void> {
  await run(
    [
      ffmpegPath,
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=90:size=1280x720:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=90",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-shortest",
      output,
    ],
    "voice E2E clip generation",
  );
}

export async function waitUntil(
  description: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 60_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await Bun.sleep(100);
  }
}

function metricSum(
  body: string,
  name: string,
  labels: readonly string[] = [],
): number {
  let total = 0;
  for (const line of body.split("\n")) {
    if (!line.startsWith(name)) continue;
    if (!labels.every((label) => line.includes(label))) continue;
    const value = Number(line.split(/\s+/).at(-1));
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

export async function metricSnapshot(): Promise<VoiceMetricSnapshot> {
  const body = await register.metrics();
  return {
    candidates: metricSum(body, "streambot_voice_wake_candidates_total"),
    localAccepted: metricSum(
      body,
      "streambot_voice_local_verifications_total",
      ['outcome="accepted"'],
    ),
    localRejected: metricSum(
      body,
      "streambot_voice_local_verifications_total",
      ['outcome="rejected"'],
    ),
    transcriptAccepted: metricSum(
      body,
      "streambot_voice_transcript_verifications_total",
      ['outcome="accepted"'],
    ),
    transcriptRejected: metricSum(
      body,
      "streambot_voice_transcript_verifications_total",
      ['outcome="rejected"'],
    ),
    cloudRateLimited: metricSum(
      body,
      "streambot_voice_cloud_verification_rate_limits_total",
    ),
    transcriptionInputTokens: metricSum(
      body,
      "streambot_voice_transcription_usage_total",
      ['unit="tokens"', 'direction="input"'],
    ),
    transcriptionOutputTokens: metricSum(
      body,
      "streambot_voice_transcription_usage_total",
      ['unit="tokens"', 'direction="output"'],
    ),
    transcriptionInputSeconds: metricSum(
      body,
      "streambot_voice_transcription_usage_total",
      ['unit="seconds"', 'direction="input"'],
    ),
    wakes: metricSum(body, "streambot_voice_wake_detections_total"),
    commandTurns: metricSum(body, "streambot_voice_turns_total", [
      'outcome="command"',
    ]),
    deniedTools: metricSum(body, "streambot_voice_tool_calls_total", [
      'outcome="denied"',
    ]),
    successfulTools: metricSum(body, "streambot_voice_tool_calls_total", [
      'outcome="success"',
    ]),
    replyPackets: metricSum(body, "streambot_voice_reply_packets_total"),
    ducked: metricSum(body, "streambot_voice_duck_transitions_total", [
      'state="ducked"',
    ]),
    restored: metricSum(body, "streambot_voice_duck_transitions_total", [
      'state="restored"',
    ]),
    failures: metricSum(body, "streambot_voice_openai_failures_total"),
    audioTokens: metricSum(body, "streambot_voice_audio_tokens_total"),
    repliesWithinTenSeconds: metricSum(
      body,
      "streambot_voice_wake_to_reply_seconds_bucket",
      ['le="10"'],
    ),
    wakeToReplyCount: metricSum(
      body,
      "streambot_voice_wake_to_reply_seconds_count",
    ),
    ffmpegOutSeconds: metricSum(
      body,
      "streambot_ffmpeg_out_time_seconds_total",
    ),
    concurrentTurns: metricSum(body, "streambot_voice_concurrent_turns"),
  };
}

export function delta(
  after: VoiceMetricSnapshot,
  before: VoiceMetricSnapshot,
  key: keyof VoiceMetricSnapshot,
): number {
  return after[key] - before[key];
}

export function assertAcceptedCascade(
  after: VoiceMetricSnapshot,
  before: VoiceMetricSnapshot,
  count: number,
): void {
  const transcriptionUsage =
    delta(after, before, "transcriptionInputTokens") +
    delta(after, before, "transcriptionOutputTokens") +
    delta(after, before, "transcriptionInputSeconds");
  if (
    delta(after, before, "candidates") !== count ||
    delta(after, before, "localAccepted") !== count ||
    delta(after, before, "localRejected") !== 0 ||
    delta(after, before, "transcriptAccepted") !== count ||
    delta(after, before, "transcriptRejected") !== 0 ||
    delta(after, before, "cloudRateLimited") !== 0 ||
    transcriptionUsage <= 0
  ) {
    throw new Error(
      `Expected ${String(count)} complete accepted voice cascades`,
    );
  }
}

export async function connectSpeaker(
  token: string,
  guildId: string,
  channelId: ChannelId,
): Promise<Speaker> {
  const client = new Client();
  const ready = new Promise<void>((resolve) => {
    client.once("ready", () => {
      resolve();
    });
  });
  await client.login(token);
  await ready;
  const streamer = new Streamer(client);
  const packetsByUser = new Map<string, Uint8Array[]>();
  let voiceSessionKey = `${guildId}/${channelId}`;
  let connection = await streamer.joinVoice(guildId, channelId, {
    receiveAudio: true,
  });
  const capturePackets = (): void => {
    streamer.voiceConnection?.on("audio", (audio) => {
      const packets = packetsByUser.get(audio.userId) ?? [];
      packets.push(audio.opus);
      packetsByUser.set(audio.userId, packets);
    });
  };
  capturePackets();
  const userId = client.user?.id;
  if (userId === undefined)
    throw new Error("E2E speaker has no Discord identity");
  return {
    client,
    streamer,
    get connection() {
      return connection;
    },
    packetsFrom: (assistantUserId) => packetsByUser.get(assistantUserId) ?? [],
    moveTo: async (nextGuildId, nextChannelId) => {
      streamer.leaveVoice();
      connection = await streamer.joinVoice(nextGuildId, nextChannelId, {
        receiveAudio: true,
      });
      voiceSessionKey = `${nextGuildId}/${nextChannelId}`;
      capturePackets();
    },
    get voiceSessionKey() {
      return voiceSessionKey;
    },
    userId,
  };
}
export async function speakFixture(
  speaker: Speaker,
  fixtureId: string,
  paceCloud = true,
): Promise<void> {
  const manifest = await loadVoiceCorpusManifest(CORPUS_DIR);
  const entry = manifest.entries.find(
    (candidate) => candidate.id === fixtureId,
  );
  if (entry === undefined)
    throw new Error(`Missing voice corpus fixture ${fixtureId}`);
  if (paceCloud && entry.expected === "wake") {
    await paceCloudVerification(speaker);
  }
  const container = decodeDiscordOpusContainer(
    new Uint8Array(
      await Bun.file(path.join(CORPUS_DIR, entry.file)).arrayBuffer(),
    ),
  );
  speaker.connection.mediaConnection.setSpeaking(true);
  try {
    for (const packet of container.packets) {
      speaker.connection.sendAudioFrame(Buffer.from(packet), 20);
      await Bun.sleep(20);
    }
  } finally {
    speaker.connection.mediaConnection.setSpeaking(false);
  }
}

export async function speakRawFile(
  speaker: Speaker,
  rawFile: string,
  ffmpegPath: string,
): Promise<void> {
  await paceCloudVerification(speaker);
  const child = Bun.spawn(
    [
      ffmpegPath,
      "-v",
      "error",
      "-i",
      rawFile,
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
  const encoder = new DiscordOpusEncoder();
  speaker.connection.mediaConnection.setSpeaking(true);
  try {
    for await (const chunk of child.stdout) {
      for (const packet of encoder.encode(chunk)) {
        speaker.connection.sendAudioFrame(Buffer.from(packet), 20);
        await Bun.sleep(20);
      }
    }
    for (const packet of encoder.finish()) {
      speaker.connection.sendAudioFrame(Buffer.from(packet), 20);
      await Bun.sleep(20);
    }
    const stderr = await new Response(child.stderr).text();
    if ((await child.exited) !== 0) {
      throw new Error(`Raw voice fixture conversion failed: ${stderr.trim()}`);
    }
  } finally {
    speaker.connection.mediaConnection.setSpeaking(false);
    encoder.close();
  }
}

export async function waitForReplyCompletion(
  speaker: Speaker,
  assistantUserId: string,
  startIndex: number,
): Promise<readonly Uint8Array[]> {
  await waitUntil(
    `reply packets from assistant ${assistantUserId}`,
    () => speaker.packetsFrom(assistantUserId).length > startIndex,
  );
  let previous = -1;
  while (previous !== speaker.packetsFrom(assistantUserId).length) {
    previous = speaker.packetsFrom(assistantUserId).length;
    await Bun.sleep(500);
  }
  return speaker.packetsFrom(assistantUserId).slice(startIndex);
}

export function validateReply(packets: readonly Uint8Array[]): void {
  if (packets.length < 3 || packets.length > 750) {
    throw new Error(
      `Assistant reply packet count is invalid: ${String(packets.length)}`,
    );
  }
  const decoder = new DiscordOpusDecoder();
  try {
    const samples = packets.flatMap((packet) => [...decoder.decode(packet)]);
    if (
      samples.length === 0 ||
      samples.some((sample) => !Number.isFinite(sample))
    ) {
      throw new Error("Assistant reply decoded to empty or non-finite audio");
    }
    const peak = samples.reduce(
      (maximum, sample) => Math.max(maximum, Math.abs(sample)),
      0,
    );
    if (peak < 0.001) throw new Error("Assistant reply is silent");
    const durationSeconds = samples.length / 16_000;
    if (durationSeconds < 0.05 || durationSeconds > 15) {
      throw new Error(
        `Assistant reply duration is invalid: ${String(durationSeconds)}s`,
      );
    }
  } finally {
    decoder.close();
  }
}

export async function runLiveTurn(options: {
  readonly speaker: Speaker;
  readonly assistantUserId: string;
  readonly fixtureId: string;
}): Promise<{ before: VoiceMetricSnapshot; after: VoiceMetricSnapshot }> {
  const before = await metricSnapshot();
  const replyStart = options.speaker.packetsFrom(
    options.assistantUserId,
  ).length;
  await speakFixture(options.speaker, options.fixtureId);
  const reply = await waitForReplyCompletion(
    options.speaker,
    options.assistantUserId,
    replyStart,
  );
  validateReply(reply);
  const after = await metricSnapshot();
  assertAcceptedCascade(after, before, 1);
  if (
    delta(after, before, "wakes") !== 1 ||
    delta(after, before, "replyPackets") !== reply.length ||
    delta(after, before, "ducked") !== 1 ||
    delta(after, before, "restored") !== 1 ||
    delta(after, before, "repliesWithinTenSeconds") !== 1 ||
    delta(after, before, "wakeToReplyCount") !== 1 ||
    after.concurrentTurns !== 0
  ) {
    throw new Error(
      `Voice turn ${options.fixtureId} produced unexpected lifecycle metrics`,
    );
  }
  return { before, after };
}

export function startPlayback(
  session: SessionHandle,
  requesterId: string,
): void {
  session.dispatch({
    type: "ADD",
    source: { kind: "file", path: BASELINE_CLIP, title: "Voice Baseline" },
    requesterId: UserIdSchema.parse(requesterId),
  });
}
