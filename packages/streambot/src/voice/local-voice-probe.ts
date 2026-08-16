import {
  DiscordOpusEncoder,
  type ReceivedVoiceAudio,
} from "@shepherdjerred/discord-video-stream";
import { normalizeVoicePlayQuery } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { LocalVoiceModels } from "@shepherdjerred/streambot/voice/local-models.ts";
import type { RealtimeCommandTurnResult } from "@shepherdjerred/streambot/voice/realtime-agent.ts";
import type {
  VoiceCommandInvocation,
  VoiceCommandPort,
} from "@shepherdjerred/streambot/voice/voice-tools.ts";
import {
  type CompletedVoiceTurn,
  VoiceAudioLifecycle,
} from "@shepherdjerred/streambot/voice/audio-lifecycle.ts";

const SILENCE_DURATION_MS = 2000;
const PCM_SAMPLE_RATE = 24_000;
const PCM_BYTES_PER_SAMPLE = 2;

export type AvfoundationAudioDevice = {
  readonly index: number;
  readonly name: string;
};

export function parseAvfoundationAudioDevices(
  output: string,
): AvfoundationAudioDevice[] {
  const devices: AvfoundationAudioDevice[] = [];
  let readingAudio = false;
  for (const line of output.split(/\r?\n/u)) {
    if (line.includes("AVFoundation audio devices:")) {
      readingAudio = true;
      continue;
    }
    if (!readingAudio) continue;
    const match = /\[(\d+)\][ \t]+/u.exec(line);
    if (match === null) continue;
    const indexText = match[1];
    const name = line.slice(match.index + match[0].length).trim();
    if (indexText === undefined || name.length === 0) continue;
    devices.push({ index: Number(indexText), name });
  }
  return devices;
}

export async function listAvfoundationAudioDevices(
  ffmpegPath: string,
): Promise<AvfoundationAudioDevice[]> {
  const subprocess = Bun.spawn(
    [
      ffmpegPath,
      "-hide_banner",
      "-f",
      "avfoundation",
      "-list_devices",
      "true",
      "-i",
      "",
    ],
    { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
  );
  const output = await new Response(subprocess.stderr).text();
  await subprocess.exited;
  const devices = parseAvfoundationAudioDevices(output);
  if (devices.length === 0) {
    throw new Error(
      `FFmpeg did not report any AVFoundation audio devices:\n${output}`,
    );
  }
  return devices;
}

export function buildAvfoundationCaptureCommand(
  ffmpegPath: string,
  deviceIndex: number,
): string[] {
  return [
    ffmpegPath,
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-f",
    "avfoundation",
    "-i",
    `:${String(deviceIndex)}`,
    "-ac",
    "1",
    "-ar",
    String(PCM_SAMPLE_RATE),
    "-f",
    "s16le",
    "pipe:1",
  ];
}

export type MacMicrophoneCapture = {
  readonly done: Promise<void>;
  readonly stop: () => Promise<void>;
};

export type MacMicrophoneProcess = {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  readonly kill: (signal: "SIGTERM") => void;
};

export function startMacMicrophoneCapture(options: {
  readonly ffmpegPath: string;
  readonly deviceIndex: number;
  readonly onPcm: (pcm24k: Uint8Array) => void;
  readonly spawn?: (command: readonly string[]) => MacMicrophoneProcess;
}): MacMicrophoneCapture {
  const command = buildAvfoundationCaptureCommand(
    options.ffmpegPath,
    options.deviceIndex,
  );
  const subprocess =
    options.spawn?.(command) ??
    Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const stopState = { requested: false };
  const stderr = new Response(subprocess.stderr).text();
  const done = (async () => {
    for await (const chunk of subprocess.stdout) options.onPcm(chunk);
    const [exitCode, errorOutput] = await Promise.all([
      subprocess.exited,
      stderr,
    ]);
    if (exitCode !== 0 && !stopState.requested) {
      throw new Error(
        `FFmpeg microphone capture exited with code ${String(exitCode)}: ${errorOutput.trim()}`,
      );
    }
  })();
  return {
    done,
    stop: async () => {
      if (!stopState.requested) {
        stopState.requested = true;
        subprocess.kill("SIGTERM");
      }
      await done;
    },
  };
}

export class DryRunVoiceCommandPort implements VoiceCommandPort {
  private readonly calls: VoiceCommandInvocation[] = [];

  get invocations(): readonly VoiceCommandInvocation[] {
    return [...this.calls];
  }

  resetInvocations(): void {
    this.calls.length = 0;
  }

  play(
    input: Parameters<VoiceCommandPort["play"]>[0],
    _signal: AbortSignal,
  ): string {
    this.calls.push({
      name: "play",
      arguments: { ...input, query: normalizeVoicePlayQuery(input.query) },
    });
    return "Dry run: the play command would execute.";
  }

  skip(): string {
    this.calls.push({ name: "skip", arguments: {} });
    return "Dry run: the current item would be skipped.";
  }

  stop(): string {
    this.calls.push({ name: "stop", arguments: {} });
    return "Dry run: playback would stop.";
  }

  seek(input: Parameters<VoiceCommandPort["seek"]>[0]): string {
    this.calls.push({ name: "seek", arguments: input });
    return "Dry run: playback would seek.";
  }

  setVolume(percent: number): string {
    this.calls.push({ name: "set_volume", arguments: { percent } });
    return "Dry run: playback volume would change.";
  }

  setLoop(mode: Parameters<VoiceCommandPort["setLoop"]>[0]): string {
    this.calls.push({ name: "set_loop", arguments: { mode } });
    return "Dry run: loop mode would change.";
  }

  shuffle(): string {
    this.calls.push({ name: "shuffle", arguments: {} });
    return "Dry run: the queue would be shuffled.";
  }

  getQueue(): string {
    this.calls.push({ name: "get_queue", arguments: {} });
    return "Dry run: the playback queue would be read.";
  }

  getNowPlaying(): string {
    this.calls.push({ name: "get_now_playing", arguments: {} });
    return "Dry run: the current item would be read.";
  }

  remove(position: number): string {
    this.calls.push({ name: "remove", arguments: { position } });
    return "Dry run: the queued item would be removed.";
  }

  clear(): string {
    this.calls.push({ name: "clear", arguments: {} });
    return "Dry run: the queue would be cleared.";
  }

  move(from: number, to: number): string {
    this.calls.push({ name: "move", arguments: { from, to } });
    return "Dry run: the queued item would move.";
  }

  jumpToChapter(
    target: Parameters<VoiceCommandPort["jumpToChapter"]>[0],
  ): string {
    this.calls.push({ name: "chapter", arguments: { target } });
    return "Dry run: playback would jump to the chapter.";
  }

  subtitlesOff(): string {
    this.calls.push({ name: "subtitles_off", arguments: {} });
    return "Dry run: subtitles would turn off.";
  }

  searchLibrary(query: string): string {
    this.calls.push({ name: "search_library", arguments: { query } });
    return "Dry run: the library would be searched.";
  }

  listChapters(): string {
    this.calls.push({ name: "list_chapters", arguments: {} });
    return "Dry run: the chapter list would be read.";
  }
}

export type LocalVoiceProbeResult =
  | { readonly outcome: "no-wake"; readonly stages: LocalVoiceProbeStages }
  | {
      readonly outcome: "abandoned";
      readonly reason: "timeout" | "empty" | "closed";
      readonly stages: LocalVoiceProbeStages;
    }
  | {
      readonly outcome: "completed";
      readonly transcript: string | null;
      readonly wakeVerified: boolean;
      readonly invocations: readonly VoiceCommandInvocation[];
      readonly stages: LocalVoiceProbeStages;
    };

export type LocalVoiceProbeStages = {
  readonly sherpaCandidate: boolean;
  readonly localVerified: boolean;
  readonly openAiContacted: boolean;
  readonly transcriptVerified: boolean;
};

export type LocalVoiceProbeOptions = {
  readonly config: Config["voice"];
  readonly models: LocalVoiceModels;
  readonly commands: DryRunVoiceCommandPort;
  readonly runTurn: (
    turn: CompletedVoiceTurn,
    commands: VoiceCommandPort,
  ) => Promise<RealtimeCommandTurnResult>;
  readonly onCandidate?: () => void;
  readonly onLocalVerification?: (accepted: boolean, score: number) => void;
  readonly onWake?: () => void;
  readonly onEndpoint?: () => void;
};

/** One bounded microphone trial routed through the production Discord Opus and local audio path. */
export class LocalVoiceProbe {
  private readonly encoder = new DiscordOpusEncoder();
  private readonly lifecycle: VoiceAudioLifecycle;
  private readonly resultPromise: Promise<LocalVoiceProbeResult>;
  private resolveResult: (result: LocalVoiceProbeResult) => void = () => {
    /* Replaced synchronously by the Promise constructor. */
  };
  private rejectResult: (error: unknown) => void = () => {
    /* Replaced synchronously by the Promise constructor. */
  };
  private wakeDetected = false;
  private candidateDetected = false;
  private openAiContacted = false;
  private transcriptVerified = false;
  private settled = false;
  private inputFinished = false;
  private ssrc = 1;

  constructor(options: LocalVoiceProbeOptions) {
    this.resultPromise = new Promise((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    this.lifecycle = new VoiceAudioLifecycle({
      models: options.models,
      preRollMs: options.config.preRollMs,
      maxUtteranceMs: options.config.maxUtteranceMs,
      onCandidate: () => {
        this.candidateDetected = true;
        options.onCandidate?.();
      },
      onLocalVerification: (evidence) => {
        options.onLocalVerification?.(evidence.accepted, evidence.score);
        if (!evidence.accepted) {
          this.settle({ outcome: "no-wake", stages: this.stages() });
        }
      },
      onLocalVerificationError: (error) => {
        this.settled = true;
        this.rejectResult(error);
      },
      onWake: () => {
        this.wakeDetected = true;
        options.onWake?.();
      },
      onAbandoned: (reason) => {
        this.settle({ outcome: "abandoned", reason, stages: this.stages() });
      },
      onTurn: async (turn) => {
        options.onEndpoint?.();
        try {
          this.openAiContacted = true;
          const realtime = await options.runTurn(turn, options.commands);
          this.transcriptVerified = realtime.wakeVerified;
          this.settle({
            outcome: "completed",
            transcript: realtime.transcript,
            wakeVerified: realtime.wakeVerified,
            invocations: options.commands.invocations,
            stages: this.stages(),
          });
        } catch (error) {
          this.settled = true;
          this.rejectResult(error);
        } finally {
          turn.pcm16k.fill(0);
        }
      },
    });
  }

  acceptPcm24k(pcm24k: Uint8Array): void {
    if (this.inputFinished) return;
    try {
      this.acceptPackets(this.encoder.encode(pcm24k));
    } finally {
      pcm24k.fill(0);
    }
  }

  async finish(): Promise<LocalVoiceProbeResult> {
    if (!this.inputFinished) {
      this.inputFinished = true;
      const silence = new Uint8Array(
        (SILENCE_DURATION_MS / 1000) * PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE,
      );
      this.acceptPackets(this.encoder.encode(silence));
      this.acceptPackets(this.encoder.finish());
      silence.fill(0);
      this.encoder.close();
      this.lifecycle.finishInput();
      if (!this.candidateDetected)
        this.settle({ outcome: "no-wake", stages: this.stages() });
    }
    return await this.resultPromise;
  }

  close(): void {
    if (!this.inputFinished) {
      this.inputFinished = true;
      this.encoder.close();
    }
    this.lifecycle.close();
    if (!this.settled) {
      this.settle(
        this.wakeDetected
          ? { outcome: "abandoned", reason: "closed", stages: this.stages() }
          : { outcome: "no-wake", stages: this.stages() },
      );
    }
  }

  private acceptPackets(packets: readonly Uint8Array[]): void {
    for (const opus of packets) {
      const audio: ReceivedVoiceAudio = {
        userId: "local-probe",
        ssrc: this.ssrc,
        opus,
      };
      this.ssrc += 1;
      this.lifecycle.accept(audio);
    }
  }

  private settle(result: LocalVoiceProbeResult): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveResult(result);
  }

  private stages(): LocalVoiceProbeStages {
    return {
      sherpaCandidate: this.candidateDetected,
      localVerified: this.wakeDetected,
      openAiContacted: this.openAiContacted,
      transcriptVerified: this.transcriptVerified,
    };
  }
}
