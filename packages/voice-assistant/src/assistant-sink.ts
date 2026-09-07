import { DiscordOpusEncoder } from "./codecs.ts";
import type {
  AssistantAudioTransport,
  DuckObserver,
  ReplyMetrics,
} from "./ports.ts";
import {
  NOOP_VOICE_ATTEMPT_OBSERVER,
  type VoiceAttemptHandle,
} from "./attempt.ts";

export type AssistantAudioSink = {
  readonly enqueue: (pcm24k: Uint8Array) => void;
  readonly finish: () => Promise<void>;
  readonly cancel: () => Promise<void>;
};

export type PacedAssistantSenderOptions = {
  /** Prefix for the reply-delivery span and outcome attribute (`${stagePrefix}.reply_delivery`). */
  readonly stagePrefix: string;
  readonly metrics: ReplyMetrics;
  readonly attempt?: VoiceAttemptHandle;
  readonly duck?: DuckObserver;
};

/** Encodes 24 kHz PCM16 reply audio to Discord Opus and paces it at one packet per 20 ms. */
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
  private readonly duck: DuckObserver | undefined;
  private readonly metrics: ReplyMetrics;
  private readonly stagePrefix: string;

  constructor(
    private readonly transport: AssistantAudioTransport,
    options: PacedAssistantSenderOptions,
  ) {
    this.attempt = options.attempt ?? NOOP_VOICE_ATTEMPT_OBSERVER.begin();
    this.duck = options.duck;
    this.metrics = options.metrics;
    this.stagePrefix = options.stagePrefix;
  }

  enqueue(pcm24k: Uint8Array): void {
    // Realtime transport callbacks can race session teardown. Once finish/cancel has sealed the
    // encoder, late audio is no longer part of this reply and must not touch the native encoder.
    if (this.cancelled || this.done) return;
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
        `${this.stagePrefix}.reply_delivery`,
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
              await this.transport.setAssistantSpeaking(false);
            } finally {
              this.duck?.duckChanged(false, outcome);
            }
            span.setAttribute(`${this.stagePrefix}.reply.outcome`, outcome);
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
      this.metrics.replyDurationSeconds.observe(
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
    await this.transport.setAssistantSpeaking(true);
    this.duck?.duckChanged(true);
    while (!this.done || this.queue.length > 0) {
      const packet = this.queue.shift();
      if (packet === undefined) {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        continue;
      }
      try {
        this.transport.sendAssistantOpus(packet);
      } catch {
        // sendOpus throws once the voice connection is gone, and this runs on
        // a 20ms tick, so a mid-reply disconnect would reject this background
        // task. That rejection later surfaces as a cancel() failure and masks
        // whatever actually ended the turn. There is nothing left to send to,
        // so count it and stop pumping.
        this.metrics.replySendFailures.inc();
        this.sendFailed = true;
        return;
      }
      this.metrics.replyPackets.inc();
      this.metrics.replyBytes.inc(packet.byteLength);
      this.sentPackets += 1;
      this.sentBytes += packet.byteLength;
      await Bun.sleep(20);
    }
  }
}
