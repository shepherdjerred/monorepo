import { EndBehaviorType } from "@discordjs/voice";
import type { VoiceAudioInput } from "@shepherdjerred/voice-assistant";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("voice-receiver-bridge");

/**
 * The receive surface this bridge needs, satisfied structurally by
 * `@discordjs/voice`'s `VoiceConnection#receiver` and by test fakes.
 */
export type OpusReceiveStream = {
  on: ((event: "data", listener: (chunk: Uint8Array) => void) => unknown) &
    ((event: "error", listener: (error: Error) => void) => unknown);
  destroy: () => void;
};

export type VoiceReceiverLike = {
  readonly speaking: {
    on: (event: "start", listener: (userId: string) => void) => unknown;
  };
  subscribe: (
    userId: string,
    options: { end: { behavior: EndBehaviorType.Manual } },
  ) => OpusReceiveStream;
};

export type VoiceReceiverBridgeOptions = {
  readonly receiver: VoiceReceiverLike;
  /** Where each received Opus packet goes: the session's audio lifecycle. */
  readonly accept: (audio: VoiceAudioInput) => void;
  /**
   * Bot audio never reaches the wake detector: the assistant's own replies,
   * sound-engine alerts, and other bots' output would otherwise be able to
   * trigger wakes attributed to their user ids.
   */
  readonly isHumanUser: (userId: string) => boolean;
};

/**
 * Bridges a @discordjs/voice receiver into the shared audio lifecycle.
 *
 * One subscription per speaker, created on the first `speaking` "start" event
 * and deduped after that — @discordjs/voice re-emits "start" after each ~100 ms
 * speech gap, and a second subscription for the same user would double every
 * packet. `EndBehaviorType.Manual` keeps the stream open across those gaps;
 * the lifecycle's own DTX handling owns endpointing, so nothing here ends a
 * stream until teardown.
 */
export class VoiceReceiverBridge {
  private readonly subscriptions = new Map<string, OpusReceiveStream>();
  private closed = false;

  constructor(private readonly options: VoiceReceiverBridgeOptions) {
    options.receiver.speaking.on("start", (userId) => {
      this.subscribeSpeaker(userId);
    });
  }

  /** Exposed for tests; production traffic arrives via the speaking event. */
  subscribeSpeaker(userId: string): void {
    if (this.closed) return;
    if (!this.options.isHumanUser(userId)) return;
    if (this.subscriptions.has(userId)) return;
    const stream = this.options.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.Manual },
    });
    this.subscriptions.set(userId, stream);
    stream.on("data", (chunk) => {
      if (this.closed) return;
      this.options.accept({ userId, opus: chunk });
    });
    stream.on("error", (error) => {
      // A dead per-speaker stream is recoverable: drop it and let the next
      // speaking "start" resubscribe. The decoder state for the speaker is
      // rebuilt by the lifecycle on its next packet.
      logger.warn(
        "voice receive stream failed; speaker resubscribes on next speech",
        {
          error: error.message,
        },
      );
      stream.destroy();
      this.subscriptions.delete(userId);
    });
  }

  get subscribedUserIds(): readonly string[] {
    return [...this.subscriptions.keys()];
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const stream of this.subscriptions.values()) {
      stream.destroy();
    }
    this.subscriptions.clear();
  }
}
