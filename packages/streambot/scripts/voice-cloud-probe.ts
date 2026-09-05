/**
 * No-mic probe for the OpenAI Realtime command turn. Feeds a decoded corpus clip
 * straight into `runRealtimeCommandTurn` N times to reproduce intermittent cloud
 * failures and surface the real error (post the realtimeErrorToError fix), without
 * needing a microphone.
 *
 * Run: OPENAI_API_KEY=... bun run scripts/voice-cloud-probe.ts [trials]
 */
import path from "node:path";
import { VoiceConfigSchema } from "@shepherdjerred/streambot/config/schema.ts";
import { DiscordOpusDecoder } from "@shepherdjerred/discord-video-stream";
import { decodeDiscordOpusContainer } from "@shepherdjerred/streambot/voice/discord-opus-container.ts";
import { runRealtimeCommandTurn } from "@shepherdjerred/streambot/voice/realtime-agent.ts";
import { DryRunVoiceCommandPort } from "@shepherdjerred/streambot/voice/local-voice-probe.ts";
import type { AssistantAudioSink } from "@shepherdjerred/streambot/voice/assistant-sink.ts";

class DiscardAssistantAudio implements AssistantAudioSink {
  enqueue(pcm24k: Uint8Array): void {
    pcm24k.fill(0);
  }
  finish(): Promise<void> {
    return Promise.resolve();
  }
  cancel(): Promise<void> {
    return Promise.resolve();
  }
}

const trials = Number(Bun.argv[2] ?? "3");
const assetsDir = path.resolve(
  import.meta.dir,
  "../../../.context/streambot-voice-models",
);
const config = VoiceConfigSchema.parse({
  enabled: true,
  openAiApiKey: Bun.env["OPENAI_API_KEY"],
  assetsDir,
  runtime: "auto",
});

const clip = path.join(
  import.meta.dir,
  "../test/fixtures/voice-corpus/clips/clean-positive-003.dopus",
);
const container = decodeDiscordOpusContainer(
  new Uint8Array(await Bun.file(clip).arrayBuffer()),
);
const decoder = new DiscordOpusDecoder();
const chunks: Float32Array[] = [];
for (const packet of container.packets) {
  const decoded = decoder.decode(packet);
  if (decoded.length > 0) chunks.push(Float32Array.from(decoded));
}
const totalSamples = chunks.reduce((n, c) => n + c.length, 0);
const pcm16k = new Float32Array(totalSamples);
let offset = 0;
for (const c of chunks) {
  pcm16k.set(c, offset);
  offset += c.length;
}
process.stdout.write(
  `Decoded ${String(container.packets.length)} opus frames → ${String(totalSamples)} samples (${(totalSamples / 16_000).toFixed(2)}s) @16kHz\n`,
);

for (let i = 1; i <= trials; i += 1) {
  const commands = new DryRunVoiceCommandPort();
  try {
    const result = await runRealtimeCommandTurn(config, {
      pcm16k: Float32Array.from(pcm16k),
      activatedAtMs: Date.now(),
      commands,
      assistantAudio: new DiscardAssistantAudio(),
    });
    process.stdout.write(
      `trial ${String(i)}: OK transcript=${JSON.stringify(result.transcript)} wakeVerified=${String(result.wakeVerified)} normalizedCommand=${JSON.stringify(result.normalizedCommand)} invocations=${JSON.stringify(commands.invocations)}\n`,
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? (error.stack ?? `${error.name}: ${error.message}`)
        : Bun.inspect(error, { depth: 5 });
    process.stdout.write(
      `trial ${String(i)}: ERROR ${detail} | invocationsAtError=${JSON.stringify(commands.invocations)}\n`,
    );
  }
  await Bun.sleep(500);
}
process.exit(0);
