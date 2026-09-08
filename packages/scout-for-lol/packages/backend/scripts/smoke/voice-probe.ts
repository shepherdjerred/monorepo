/**
 * Manual Hey Scout microphone probe: mic → shared audio lifecycle → one
 * OpenAI Realtime turn with the League tools. No Discord involved — this is
 * the fastest way to exercise the full wake → transcribe → tool-call → answer
 * path against the committed data assets. Mirrors streambot's
 * `local-voice-probe.ts`/`voice-harness.ts` pair, trimmed to one always-on
 * loop.
 *
 * Requirements (deliberately not checked into CI):
 *  - macOS with ffmpeg on PATH (AVFoundation capture);
 *  - trained hey-scout assets in --assets-dir (see
 *    `src/voice-assistant/constants.ts` for the manifest filenames);
 *  - OPENAI_API_KEY in the environment.
 *
 * Usage:
 *   bun scripts/smoke/voice-probe.ts --list-devices
 *   OPENAI_API_KEY=... bun scripts/smoke/voice-probe.ts --device 1 --assets-dir ~/scout-voice-models
 *
 * Say "hey scout, how much true damage does Cho'Gath ult do at rank one" and
 * expect a printed transcript plus the grounded tool calls. Assistant reply
 * audio is discarded (this probe checks grounding, not playback).
 */
import { parseArgs } from "node:util";
import {
  createNoopVoiceMetrics,
  buildAvfoundationCaptureCommand,
  DiscordOpusEncoder,
  initializeLocalVoiceModels,
  listAvfoundationAudioDevices,
  loadSpokenFeedbackClips,
  NOOP_VOICE_LOGGER,
  runRealtimeCommandTurn,
  VoiceAudioLifecycle,
  type AssistantAudioSink,
  type SpokenFeedbackClips,
} from "@shepherdjerred/voice-assistant";
import {
  scoutVoiceAssetManifest,
  VOICE_FEEDBACK_CLIP_FILES,
  VOICE_FRAGMENT_TAIL_MS,
  VOICE_MAX_UTTERANCE_MS,
  VOICE_PRE_ROLL_MS,
} from "#src/voice-assistant/constants.ts";
import { scoutRealtimeTurnOptions } from "#src/voice-assistant/session.ts";
import { VoiceTurnFactsRecorder } from "#src/voice-assistant/league-tools.ts";

const help = `Hey Scout local voice probe

Usage:
  bun scripts/smoke/voice-probe.ts --list-devices
  OPENAI_API_KEY=... bun scripts/smoke/voice-probe.ts --device <index> [--assets-dir <path>]

Options:
  --device <index>       AVFoundation audio-device index
  --assets-dir <path>    Trained hey-scout assets (default: $VOICE_ASSETS_DIR or /opt/scout/voice)
  --list-devices         List AVFoundation microphone indices
  --no-feedback-clips    Skip the feedback WAVs (pre-training runs only; a
                         complete bundle must load them or the probe fails,
                         exactly like production's fatal bootstrap)
  -h, --help             Show this help

Ctrl-C quits.`;

const LIST_DEVICES_OPTION = { type: "boolean", default: false } as const;
const HELP_OPTION = { type: "boolean", short: "h", default: false } as const;

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

async function listDevices(): Promise<void> {
  const devices = await listAvfoundationAudioDevices("ffmpeg");
  for (const device of devices) {
    console.log(`[${String(device.index)}] ${device.name}`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      // This intentionally permits an incomplete pre-training bundle.
      "no-feedback-clips": { type: "boolean", default: false },
      device: { type: "string" },
      "assets-dir": { type: "string" },
      "list-devices": LIST_DEVICES_OPTION,
      help: HELP_OPTION,
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (process.platform !== "darwin") {
    throw new Error("The microphone probe uses AVFoundation and is macOS-only");
  }
  if (values["list-devices"]) {
    await listDevices();
    return;
  }
  const deviceText = values.device;
  if (deviceText === undefined) {
    throw new Error("Pass --device <index>; find one with --list-devices");
  }
  const deviceIndex = Number(deviceText);
  if (!Number.isInteger(deviceIndex) || deviceIndex < 0) {
    throw new Error("--device must be a non-negative AVFoundation index");
  }
  const apiKey = Bun.env["OPENAI_API_KEY"];
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("OPENAI_API_KEY is required for the Realtime turn");
  }
  const assetsDir =
    values["assets-dir"] ?? Bun.env["VOICE_ASSETS_DIR"] ?? "/opt/scout/voice";

  console.log(`Loading hey-scout models from ${assetsDir} ...`);
  const models = await initializeLocalVoiceModels(
    scoutVoiceAssetManifest(assetsDir),
    "auto",
    NOOP_VOICE_LOGGER,
  );
  // The probe is the trained-asset acceptance tool, so a missing or
  // malformed feedback WAV fails it exactly like production's fatal
  // bootstrap would — a passing probe must mean a bootable bundle. Skipping
  // is an explicit pre-training opt-out, never a silent downgrade.
  let feedbackClips: SpokenFeedbackClips | undefined;
  if (values["no-feedback-clips"]) {
    console.log(
      "(--no-feedback-clips: rejected/bare wakes stay silent; this bundle is NOT production-complete)",
    );
  } else {
    feedbackClips = await loadSpokenFeedbackClips(
      assetsDir,
      VOICE_FEEDBACK_CLIP_FILES,
    );
  }

  const noop = createNoopVoiceMetrics();
  const encoder = new DiscordOpusEncoder();
  const lifecycle = new VoiceAudioLifecycle({
    models,
    preRollMs: VOICE_PRE_ROLL_MS,
    maxUtteranceMs: VOICE_MAX_UTTERANCE_MS,
    fragmentTailMs: VOICE_FRAGMENT_TAIL_MS,
    metrics: noop.lifecycle,
    observability: { logger: NOOP_VOICE_LOGGER, stagePrefix: "scout.voice" },
    onCandidate: (candidate) => {
      console.log(`sherpa candidate: ${candidate.phrase}`);
    },
    onLocalVerification: (evidence) => {
      console.log(
        `local verifier: ${evidence.accepted ? "ACCEPTED" : "rejected"} (score ${evidence.score.toFixed(3)})`,
      );
    },
    onTurn: async (turn) => {
      const recorder = new VoiceTurnFactsRecorder();
      try {
        const result = await runRealtimeCommandTurn(
          scoutRealtimeTurnOptions(apiKey, recorder),
          {
            pcm16k: turn.pcm16k,
            activatedAtMs: turn.activatedAtMs,
            assistantAudio: new DiscardAssistantAudio(),
            ...(feedbackClips === undefined ? {} : { feedbackClips }),
          },
        );
        console.log(`transcript: ${JSON.stringify(result.transcript ?? "")}`);
        console.log(`wake verified: ${result.wakeVerified ? "Y" : "N"}`);
        if (recorder.champion !== undefined) {
          console.log(
            `grounded in: ${recorder.champion} ${recorder.slot ?? ""}`,
          );
        }
      } catch (error) {
        console.error("realtime turn failed:", error);
      } finally {
        turn.pcm16k.fill(0);
      }
    },
  });

  console.log(
    `Capturing from device ${deviceText}. Say "hey scout, ..." (Ctrl-C quits)`,
  );
  const subprocess = Bun.spawn(
    buildAvfoundationCaptureCommand("ffmpeg", deviceIndex),
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  process.on("SIGINT", () => {
    subprocess.kill("SIGTERM");
    lifecycle.close();
    void (async () => {
      await models.close();
      process.exit(0);
    })();
  });
  for await (const chunk of subprocess.stdout) {
    for (const opus of encoder.encode(chunk)) {
      lifecycle.accept({ userId: "local-probe", opus });
    }
    chunk.fill(0);
  }
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    const stderrText = await new Response(subprocess.stderr).text();
    throw new Error(
      `ffmpeg exited with ${String(exitCode)}: ${stderrText.trim()}`,
    );
  }
}

if (import.meta.main) await main();
