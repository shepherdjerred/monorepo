import type { AssistantAudioPort } from "@shepherdjerred/streambot/streamer/audio-ports.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("assistant-transport");

/**
 * The two methods `@shepherdjerred/voice-assistant` calls to speak, backed by one mixer port.
 *
 * The shared voice pipeline is consumed by two bots, so it owns its own `AssistantAudioTransport`
 * interface: `setAssistantSpeaking` plus a `void`-returning `sendAssistantOpus`. Streambot cannot
 * satisfy that by writing to the connection directly — the mixer is the only component allowed to
 * touch `sendAudioFrame`, because music and the assistant share one packetizer, SSRC and RTP
 * timestamp. This adapter is the seam between the two shapes.
 *
 * It holds ONE port for the lifetime of the connection rather than opening one per reply. The
 * speaking claim and the mixer's assistant queue are per connection, so a port per packet would
 * thrash both, and the arbitration that keeps the green ring lit through a song depends on the
 * claim outliving any single reply.
 */
export class AssistantTransport {
  private port: AssistantAudioPort | null = null;

  constructor(private readonly openPort: () => AssistantAudioPort) {}

  private current(): AssistantAudioPort {
    this.port ??= this.openPort();
    return this.port;
  }

  setSpeaking(speaking: boolean): Promise<void> {
    this.current().setSpeaking(speaking);
    return Promise.resolve();
  }

  /**
   * Fire-and-forget by contract: the shared pipeline's transport returns `void` and paces itself,
   * so there is no caller to await this and no caller that could act on a failure. A rejection
   * means the connection went away mid-reply, which that reply's own failure accounting already
   * records; logging it here keeps it visible without turning it into an unhandled rejection.
   */
  send(opus: Uint8Array): void {
    void this.deliver(opus);
  }

  private async deliver(opus: Uint8Array): Promise<void> {
    try {
      await this.current().send(opus);
    } catch (error) {
      log.warn("assistant audio frame dropped", {
        error: getErrorMessage(error),
      });
    }
  }

  /** Drop the port so the next reply opens a fresh one. Called when the connection is torn down. */
  reset(): void {
    this.port?.close();
    this.port = null;
  }
}
