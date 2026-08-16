import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { VoiceConfigSchema } from "@shepherdjerred/streambot/config/schema.ts";
import {
  initializeLocalVoiceModels,
  validateVoiceAssets,
} from "@shepherdjerred/streambot/voice/local-models.ts";
import {
  DryRunVoiceCommandPort,
  listAvfoundationAudioDevices,
  LocalVoiceProbe,
  type LocalVoiceProbeResult,
  startMacMicrophoneCapture,
  type MacMicrophoneCapture,
} from "@shepherdjerred/streambot/voice/local-voice-probe.ts";
import { wakePcmToOpenAiPcm } from "@shepherdjerred/discord-video-stream";
import { runRealtimeCommandTurn } from "@shepherdjerred/streambot/voice/realtime-agent.ts";
import type { AssistantAudioSink } from "@shepherdjerred/streambot/voice/assistant-sink.ts";
import {
  DebugAudioRecorder,
  type DebugAudioRecording,
} from "@shepherdjerred/streambot/voice/debug-audio-recorder.ts";

const RECORDING_LIMIT_MS = 20_000;
const defaultAssetsDir = path.resolve(
  import.meta.dir,
  "../../../.context/streambot-voice-models",
);
const defaultRecordingsDir = path.resolve(
  import.meta.dir,
  "../../../.context/streambot-voice-recordings",
);

const help = `Streambot local voice probe

Usage:
  bun run voice:harness --list-devices
  OPENAI_API_KEY=... bun run voice:harness --device <index>

Options:
  --device <index>       AVFoundation audio-device index
  --assets-dir <path>    Prepared voice assets (default: ${defaultAssetsDir})
  --list-devices         List AVFoundation microphone indices
  --save-recordings      Save raw and exact OpenAI-input diagnostic WAV files under .context
  --recordings-dir <dir> Save WAV files to this directory (implies --save-recordings)
  -h, --help             Show this help

Controls:
  Enter   Start or stop one trial
  q       Quit
  Ctrl-C  Quit and clean up
`;

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

type ActiveTrial = {
  readonly commands: DryRunVoiceCommandPort;
  readonly probe: LocalVoiceProbe;
  readonly capture: MacMicrophoneCapture;
  readonly recorder: DebugAudioRecorder | null;
  readonly recordingPath: string | null;
  readonly timer: ReturnType<typeof setTimeout>;
  stopPromise: Promise<void> | null;
};

function printResult(result: LocalVoiceProbeResult): void {
  console.log(`Sherpa candidate: ${result.stages.sherpaCandidate ? "Y" : "N"}`);
  console.log(`Local verification: ${result.stages.localVerified ? "Y" : "N"}`);
  console.log(`OpenAI contacted: ${result.stages.openAiContacted ? "Y" : "N"}`);
  console.log(
    `Transcript verification: ${result.stages.transcriptVerified ? "Y" : "N"}`,
  );
  switch (result.outcome) {
    case "no-wake":
      console.log("Wake: N");
      return;
    case "abandoned":
      console.log("Wake: Y");
      console.log(`Command: abandoned (${result.reason})`);
      return;
    case "completed":
      console.log("Wake: Y");
      console.log(`Transcript: ${JSON.stringify(result.transcript ?? "")}`);
      if (result.invocations.length === 0) {
        console.log("Command: none");
        return;
      }
      for (const invocation of result.invocations) {
        console.log(
          `Command: ${invocation.name} ${JSON.stringify(invocation.arguments)}`,
        );
      }
  }
}

function printRecording(
  label: "Recording" | "OpenAI input",
  recording: DebugAudioRecording,
): void {
  console.log(`${label}: ${recording.path}`);
  console.log(
    `Audio: ${recording.durationSeconds.toFixed(2)}s, peak ${recording.peak.toFixed(4)}, RMS ${recording.rms.toFixed(4)}`,
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      device: { type: "string" },
      "assets-dir": { type: "string" },
      "recordings-dir": { type: "string" },
      "save-recordings": { type: "boolean", default: false },
      "list-devices": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (process.platform !== "darwin") {
    throw new Error(
      "The local microphone probe currently requires macOS AVFoundation.",
    );
  }
  const ffmpegPath = Bun.which("ffmpeg");
  if (ffmpegPath === null) {
    throw new Error(
      "FFmpeg is required. Install it before running the voice probe.",
    );
  }
  if (values["list-devices"]) {
    const devices = await listAvfoundationAudioDevices(ffmpegPath);
    for (const device of devices) {
      console.log(`[${String(device.index)}] ${device.name}`);
    }
    return;
  }
  const deviceIndex = z.coerce
    .number()
    .int()
    .nonnegative()
    .parse(values.device);
  const assetsDir = path.resolve(values["assets-dir"] ?? defaultAssetsDir);
  const saveRecordings =
    values["save-recordings"] || values["recordings-dir"] !== undefined;
  const recordingsDir = path.resolve(
    values["recordings-dir"] ?? defaultRecordingsDir,
  );
  const openAiApiKey = z.string().min(1).parse(Bun.env["OPENAI_API_KEY"]);
  const config = VoiceConfigSchema.parse({
    enabled: true,
    openAiApiKey,
    assetsDir,
    runtime: "auto",
  });
  try {
    await validateVoiceAssets(assetsDir);
  } catch (error) {
    throw new Error(
      `Voice assets are missing or invalid at ${assetsDir}. Run: bun run voice:harness:prepare`,
      { cause: error },
    );
  }
  const models = await initializeLocalVoiceModels(config);
  if (models === null) {
    throw new Error("Voice models did not initialize for an enabled probe.");
  }
  if (!process.stdin.isTTY) {
    throw new Error(
      "The interactive voice probe requires a terminal on stdin.",
    );
  }

  console.log("Streambot local voice probe");
  console.log(`KWS runtime: ${models.runtime}`);
  console.log(`Microphone index: ${String(deviceIndex)}`);
  if (saveRecordings) {
    console.log(`Diagnostic WAV directory: ${recordingsDir}`);
  }
  console.log("Press Enter to record, q to quit.");

  let active: ActiveTrial | null = null;
  let quitting = false;
  const quit = Promise.withResolvers<undefined>();

  const stopTrial = async (
    reason: "manual" | "endpoint" | "limit",
  ): Promise<void> => {
    const trial = active;
    if (trial === null) return;
    if (trial.stopPromise !== null) {
      await trial.stopPromise;
      return;
    }
    trial.stopPromise = (async () => {
      clearTimeout(trial.timer);
      if (reason === "limit") console.log("Recording limit reached.");
      if (reason === "endpoint") console.log("Command endpoint detected.");
      try {
        let captureSucceeded = true;
        let captureFailure: unknown;
        try {
          await trial.capture.stop();
        } catch (error) {
          captureSucceeded = false;
          captureFailure = error;
        }
        const recording =
          trial.recorder === null || trial.recordingPath === null
            ? null
            : await trial.recorder.save(trial.recordingPath);
        if (recording !== null) printRecording("Recording", recording);
        if (!captureSucceeded) throw captureFailure;
        printResult(await trial.probe.finish());
      } finally {
        trial.recorder?.close();
        trial.commands.resetInvocations();
        trial.probe.close();
        if (active === trial) active = null;
        if (!quitting) console.log("Press Enter to record, q to quit.");
      }
    })();
    await trial.stopPromise;
  };

  const startTrial = () => {
    if (active !== null) return;
    const commands = new DryRunVoiceCommandPort();
    const recorder = saveRecordings ? new DebugAudioRecorder() : null;
    const trialId = `${new Date().toISOString().replaceAll(":", "-")}-${crypto.randomUUID()}`;
    const recordingPath =
      recorder === null
        ? null
        : path.join(recordingsDir, `trial-${trialId}.wav`);
    const openAiRecordingPath =
      recorder === null
        ? null
        : path.join(recordingsDir, `openai-input-${trialId}.wav`);
    const probe = new LocalVoiceProbe({
      config,
      models,
      commands,
      onCandidate: () => {
        console.log("Sherpa candidate detected; verifying locally…");
      },
      onLocalVerification: (accepted, score) => {
        console.log(
          `Local verifier: ${accepted ? "pass" : "reject"} (${score.toFixed(4)})`,
        );
      },
      onWake: () => {
        console.log("Local wake verified; listening for command…");
      },
      onEndpoint: () => void safelyStopTrial("endpoint"),
      runTurn: async (turn, commandPort) => {
        if (openAiRecordingPath !== null) {
          const inputRecorder = new DebugAudioRecorder();
          const pcm24k = wakePcmToOpenAiPcm(turn.pcm16k);
          try {
            inputRecorder.accept(pcm24k);
            printRecording(
              "OpenAI input",
              await inputRecorder.save(openAiRecordingPath),
            );
          } finally {
            pcm24k.fill(0);
            inputRecorder.close();
          }
        }
        return runRealtimeCommandTurn(config, {
          pcm16k: turn.pcm16k,
          activatedAtMs: turn.activatedAtMs,
          commands: commandPort,
          assistantAudio: new DiscardAssistantAudio(),
        });
      },
    });
    let capture: MacMicrophoneCapture;
    try {
      capture = startMacMicrophoneCapture({
        ffmpegPath,
        deviceIndex,
        onPcm: (pcm24k) => {
          recorder?.accept(pcm24k);
          probe.acceptPcm24k(pcm24k);
        },
      });
    } catch (error) {
      probe.close();
      recorder?.close();
      commands.resetInvocations();
      throw error;
    }
    const timer = setTimeout(() => {
      void safelyStopTrial("limit");
    }, RECORDING_LIMIT_MS);
    active = {
      commands,
      probe,
      capture,
      recorder,
      recordingPath,
      timer,
      stopPromise: null,
    };
    const monitorCapture = async (): Promise<void> => {
      try {
        await capture.done;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        await safelyStopTrial("manual");
      }
    };
    void monitorCapture();
    console.log("Recording… press Enter to stop.");
  };

  async function safelyStopTrial(
    reason: "manual" | "endpoint" | "limit",
  ): Promise<void> {
    try {
      await stopTrial(reason);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  const requestQuit = async () => {
    if (quitting) return;
    quitting = true;
    try {
      await safelyStopTrial("manual");
    } finally {
      quit.resolve(undefined);
    }
  };

  const handleInput = async (chunk: string): Promise<void> => {
    for (const key of chunk) {
      if (key === "\u{3}" || key === "q" || key === "Q") {
        await requestQuit();
        return;
      }
      if (key !== "\r" && key !== "\n") continue;
      if (active === null) startTrial();
      else await safelyStopTrial("manual");
    }
  };
  const processInput = async (chunk: string): Promise<void> => {
    try {
      await handleInput(chunk);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      await requestQuit();
    }
  };
  const onData = (chunk: string) => {
    void processInput(chunk);
  };
  const onSigterm = () => {
    void requestQuit();
  };

  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", onData);
  process.on("SIGTERM", onSigterm);
  try {
    await quit.promise;
  } finally {
    process.off("SIGTERM", onSigterm);
    process.stdin.off("data", onData);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    await models.close();
    console.log("Voice probe stopped.");
  }
}

await main().catch((error: unknown) => {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
