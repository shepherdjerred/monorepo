import { DiscordOpusEncoder } from "@shepherdjerred/discord-video-stream";
import type { StreamerLike } from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import {
  voiceReplyPacketsTotal,
  voiceReplySendFailuresTotal,
} from "@shepherdjerred/streambot/observability/metrics.ts";

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

  constructor(private readonly streamer: StreamerLike) {}

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
    try {
      if (flush && !this.cancelled) this.queue.push(...this.encoder.finish());
      this.done = true;
      this.start();
      this.wake?.();
      this.wake = null;
      await this.task;
    } finally {
      this.encoder.close();
      await this.streamer.setAssistantSpeaking(false);
    }
  }

  private start(): void {
    this.task ??= this.run();
  }

  private async run(): Promise<void> {
    await this.streamer.setAssistantSpeaking(true);
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

        return;
      }
      voiceReplyPacketsTotal.inc();
      await Bun.sleep(20);
    }
  }
}
