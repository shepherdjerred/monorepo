import type { DuckObserver } from "@shepherdjerred/voice-assistant";
import type { PlaybackGate } from "#src/voice/voice-manager.ts";

/**
 * Arbitrates the one voice connection's two audio producers: the assistant's
 * paced Opus reply and the sound-engine's alert playback.
 *
 * A Discord voice connection carries exactly one outbound Opus stream.
 * `PacedAssistantSender` (raw `connection.playOpusPacket` calls) and the
 * sound-engine's `AudioPlayer` (a `connection.subscribe()`-driven resource
 * stream) are two INDEPENDENT producers onto that same stream — there is no
 * mixer, so "ducking" one's volume while both are still sending would not
 * combine them; it would let their packets interleave and corrupt the
 * outbound audio. This is therefore a genuine bidirectional reservation, not
 * a one-way check:
 *
 * - An alert (`playbackGate()`) waits for the assistant to fall silent,
 *   marks the guild reserved, and the caller MUST call the returned
 *   `release()` once its own playback fully ends (`VoiceManager.playSound`
 *   does this in a `finally`) — otherwise a wake accepted mid-alert would
 *   send assistant packets over it.
 * - The assistant (`reserveForAssistant()`) waits for an in-flight alert to
 *   finish before its sender is allowed to send its first packet
 *   (`assistant-sender.ts` awaits this inside `setAssistantSpeaking(true)`,
 *   which the shared package always awaits before sending anything).
 *
 * Both waits are unbounded on purpose. The assistant side is safe because
 * `PacedAssistantSender` guarantees a `duckChanged(false)` on every
 * completion path (success, cancel, failure); the alert side is safe because
 * `VoiceManager.playSound` guarantees `release()` on every completion path
 * (idle, error, or its own 60 s timeout) the same way.
 */
export class VoiceOutputArbiter {
  /** Guild -> the assistant is currently sending reply audio. */
  private readonly speakingGuilds = new Set<string>();
  /** Guild -> an alert is currently reserved to send audio. */
  private readonly playingAlertGuilds = new Set<string>();
  /** Alerts waiting for the assistant to fall silent. */
  private readonly waitersForAssistantSilence = new Map<
    string,
    (() => void)[]
  >();
  /** The assistant waiting for an in-flight alert to release the connection. */
  private readonly waitersForAlertRelease = new Map<string, (() => void)[]>();

  /** The duck observer for one guild's assistant reply sender. */
  assistantDuck(guildId: string): DuckObserver {
    return {
      duckChanged: (ducked) => {
        if (ducked) {
          this.speakingGuilds.add(guildId);
          return;
        }
        this.speakingGuilds.delete(guildId);
        this.wake(this.waitersForAssistantSilence, guildId);
      },
    };
  }

  isAssistantSpeaking(guildId: string): boolean {
    return this.speakingGuilds.has(guildId);
  }

  /**
   * Awaited inside the assistant sender's `setAssistantSpeaking(true)`,
   * before any reply packet is sent. Resolves immediately when no alert is
   * reserved; otherwise waits for that alert's `release()`.
   */
  async reserveForAssistant(guildId: string): Promise<void> {
    if (!this.playingAlertGuilds.has(guildId)) return;
    await this.waitFor(this.waitersForAlertRelease, guildId);
  }

  /**
   * The gate `VoiceManager.playSound` consults before starting an alert:
   * waits for the assistant to finish, then reserves the connection for this
   * alert until the caller calls the returned `release()`.
   */
  playbackGate(): PlaybackGate {
    return async (guildId) => {
      if (this.speakingGuilds.has(guildId)) {
        await this.waitFor(this.waitersForAssistantSilence, guildId);
      }
      this.playingAlertGuilds.add(guildId);
      return {
        volumeMultiplier: 1,
        release: () => {
          this.playingAlertGuilds.delete(guildId);
          this.wake(this.waitersForAlertRelease, guildId);
        },
      };
    };
  }

  private waitFor(
    waiters: Map<string, (() => void)[]>,
    guildId: string,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const pending = waiters.get(guildId) ?? [];
      pending.push(resolve);
      waiters.set(guildId, pending);
    });
  }

  private wake(waiters: Map<string, (() => void)[]>, guildId: string): void {
    const pending = waiters.get(guildId) ?? [];
    waiters.delete(guildId);
    for (const settle of pending) settle();
  }
}

/** Process-wide arbiter shared by the manager wiring and the sound engine gate. */
export const voiceOutputArbiter = new VoiceOutputArbiter();
