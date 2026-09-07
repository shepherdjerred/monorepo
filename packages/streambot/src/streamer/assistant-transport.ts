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
  /** Latched delivery failure, rethrown from the next {@link send} so the reply can fail. */
  private failure: Error | null = null;

  constructor(private readonly openPort: () => AssistantAudioPort) {}

  private current(): AssistantAudioPort {
    this.port ??= this.openPort();
    return this.port;
  }

  setSpeaking(speaking: boolean): Promise<void> {
    this.current().setSpeaking(speaking);
    if (speaking) {
      // A reply claims the flag before its first packet, so this is its start boundary. Clearing
      // here scopes a failure to the reply that caused it — otherwise a rejection on a reply's
      // LAST packet, which has no later send to surface through, would be thrown by the first
      // packet of the next healthy reply and fail a turn that never had a problem.
      this.failure = null;
      return Promise.resolve();
    }
    // Releasing the flag is the reply's END boundary, and `PacedAssistantSender` awaits it. A
    // failure still latched here belongs to THIS reply — its final packet — and this is the last
    // moment it can be attributed correctly. Reporting it lets the reply be recorded as failed
    // instead of completing successfully with its tail unheard.
    const pending = this.failure;
    this.failure = null;
    return pending === null ? Promise.resolve() : Promise.reject(pending);
  }

  /**
   * Send one packet, and surface any earlier failure to the caller.
   *
   * The shared pipeline's transport returns `void`, so the delivery itself cannot be awaited here.
   * But `PacedAssistantSender` decides a reply failed by catching a SYNCHRONOUS throw from this
   * method — swallowing the rejection instead would let it increment the sent counters and finish
   * a reply that nobody heard, which is exactly the silent success this package's guidance says
   * must never be possible on the audio path.
   *
   * So a rejection is latched and thrown from the NEXT call. The sender pumps on a 20 ms tick, so
   * the signal arrives within one packet — early enough for it to stop pumping and count the
   * failure, which is all it does with the information. A failure on the very last packet of a
   * reply has no next call to surface through; that one is caught by the mixer's dropped-frame
   * counter instead, which is why both signals exist.
   */
  send(opus: Uint8Array): void {
    const pending = this.failure;
    if (pending !== null) {
      this.failure = null;
      throw pending;
    }
    void this.deliver(opus);
  }

  private async deliver(opus: Uint8Array): Promise<void> {
    try {
      await this.current().send(opus);
    } catch (error) {
      log.warn("assistant audio frame dropped", {
        error: getErrorMessage(error),
      });
      this.failure = error instanceof Error ? error : new Error(String(error));
    }
  }

  /** Drop the port so the next reply opens a fresh one. Called when the connection is torn down. */
  reset(): void {
    this.port?.close();
    this.port = null;
    // A torn-down connection is not a reply failure to report into the next reply, which will open
    // a fresh port against a fresh connection.
    this.failure = null;
  }
}
