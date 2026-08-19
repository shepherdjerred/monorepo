import { DiscordOpusEncoder } from "@shepherdjerred/discord-video-stream";
import type { StreamerLike } from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import {
  voiceReplyPacketsTotal,
  voiceReplySendFailuresTotal,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import {
  voiceReplyBytesTotal,
  voiceReplyDurationSeconds,
} from "@shepherdjerred/streambot/observability/voice-diagnostic-metrics.ts";
import {
  NOOP_VOICE_ATTEMPT_OBSERVER,
  type VoiceAttemptHandle,
} from "@shepherdjerred/streambot/voice/attempt-context.ts";
import type { VoiceSessionTelemetry } from "@shepherdjerred/streambot/observability/voice-session.ts";

export type AssistantAudioSink = {
  readonly enqueue: (pcm24k: Uint8Array) => void;
  readonly finish: () => Promise<void>;
  readonly cancel: () => Promise<void>;
};

export class PacedAssistantSender implements AssistantAudioSink {
  private readonly encoder = new DiscordOpusEncoder();
  private readonly queue: Uint8Array[] = [];
  private task: Promise<void> | null = null;
  private finishTask: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  private done = false;
  private cancelled = false;
  private sendFailed = false;
  private sentPackets = 0;
  private sentBytes = 0;
  private readonly attempt: VoiceAttemptHandle;
  private readonly telemetry: VoiceSessionTelemetry | undefined;

  constructor(
    private readonly streamer: StreamerLike,
    options: {
      readonly attempt?: VoiceAttemptHandle;
      readonly telemetry?: VoiceSessionTelemetry;
    } = {},
  ) {
    this.attempt = options.attempt ?? NOOP_VOICE_ATTEMPT_OBSERVER.begin();
    this.telemetry = options.telemetry;
  }

  enqueue(pcm24k: Uint8Array): void {
    if (this.cancelled) return;
    this.queue.push(...this.encoder.encode(pcm24k));
    this.start();
    this.wake?.();
    this.wake = null;
  }

  finish(): Promise<void> {
    this.finishTask ??= this.complete(true);
    return this.finishTask;
  }

  cancel(): Promise<void> {
    this.cancelled = true;
    this.queue.length = 0;
    if (this.task === null) {
      this.done = true;
      this.encoder.close();
      this.attempt.reply({
        outcome: "cancelled-no-audio",
        packets: 0,
        bytes: 0,
        durationMs: 0,
      });
      this.finishTask ??= Promise.resolve();
      return this.finishTask;
    }
    this.finishTask ??= this.complete(false);
    this.done = true;
    this.wake?.();
    this.wake = null;
    return this.finishTask;
  }

  private async complete(flush: boolean): Promise<void> {
    const startedAt = performance.now();
    let outcome = this.cancelled ? "cancelled" : "success";
    try {
      await this.attempt.runStage(
        "streambot.voice.reply_delivery",
        {},
        async (span) => {
          try {
            if (flush && !this.cancelled)
              this.queue.push(...this.encoder.finish());
            this.done = true;
            this.start();
            this.wake?.();
            this.wake = null;
            await this.task;
            if (this.sendFailed) {
              outcome = "failure";
              throw new Error("Assistant reply delivery failed");
            }
          } finally {
            this.encoder.close();
            try {
              await this.streamer.setAssistantSpeaking(false);
            } finally {
              this.telemetry?.duckChanged(false, outcome);
            }
            span.setAttribute("streambot.voice.reply.outcome", outcome);
          }
        },
      );
    } catch (error) {
      outcome = "failure";
      this.attempt.reply({
        outcome,
        packets: this.sentPackets,
        bytes: this.sentBytes,
        durationMs: performance.now() - startedAt,
      });
      throw error;
    } finally {
      voiceReplyDurationSeconds.observe(
        { outcome },
        (performance.now() - startedAt) / 1000,
      );
      if (outcome !== "failure") {
        this.attempt.reply({
          outcome,
          packets: this.sentPackets,
          bytes: this.sentBytes,
          durationMs: performance.now() - startedAt,
        });
      }
    }
  }

  private start(): void {
    this.task ??= this.run();
  }

  private async run(): Promise<void> {
    await this.streamer.setAssistantSpeaking(true);
    this.telemetry?.duckChanged(true);
    while (!this.done || this.queue.length > 0) {
      const packet = this.queue.shift();
      if (packet === undefined) {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        continue;
      }
      try {
        this.streamer.sendAssistantOpus(packet);
      } catch {
        // sendOpus throws once the voice connection is gone, and this runs on
        // a 20ms tick, so a mid-reply disconnect would reject this background
        // task. That rejection later surfaces as a cancel() failure and masks
        // whatever actually ended the turn. There is nothing left to send to,
        // so count it and stop pumping.
        voiceReplySendFailuresTotal.inc();
        this.sendFailed = true;
        return;
      }
      voiceReplyPacketsTotal.inc();
      voiceReplyBytesTotal.inc(packet.byteLength);
      this.sentPackets += 1;
      this.sentBytes += packet.byteLength;
      await Bun.sleep(20);
    }
  }
}
