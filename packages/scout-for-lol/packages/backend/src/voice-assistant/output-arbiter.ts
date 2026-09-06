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
 * mixer. Lowering only the alert's volume while both are still sending would
 * not combine them; it would let their packets interleave and corrupt the
 * outbound audio. So this never "ducks": it always waits for the assistant to
 * fall fully silent before letting an alert's packets reach the connection.
 * The wait is unbounded on purpose — `PacedAssistantSender` guarantees a
 * `duckChanged(false)` on every completion path (success, cancel, failure),
 * so this can never hang behind a stuck turn.
 */
export class VoiceOutputArbiter {
  private readonly speakingGuilds = new Set<string>();
  private readonly waiters = new Map<string, (() => void)[]>();

  /** The duck observer for one guild's assistant reply sender. */
  assistantDuck(guildId: string): DuckObserver {
    return {
      duckChanged: (ducked) => {
        if (ducked) {
          this.speakingGuilds.add(guildId);
          return;
        }
        this.speakingGuilds.delete(guildId);
        const pending = this.waiters.get(guildId) ?? [];
        this.waiters.delete(guildId);
        for (const wake of pending) wake();
      },
    };
  }

  isAssistantSpeaking(guildId: string): boolean {
    return this.speakingGuilds.has(guildId);
  }

  /**
   * The gate `VoiceManager.playSound` consults before starting an alert:
   * waits for the assistant to finish before letting the alert onto the
   * connection, so the two producers are never concurrent. An alert is
   * delayed, never dropped or corrupted; the returned multiplier is always 1
   * since nothing here ever plays at a reduced volume.
   */
  playbackGate(): PlaybackGate {
    return async (guildId) => {
      if (this.speakingGuilds.has(guildId)) {
        await this.waitForQuiet(guildId);
      }
      return { volumeMultiplier: 1 };
    };
  }

  private waitForQuiet(guildId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const pending = this.waiters.get(guildId) ?? [];
      pending.push(resolve);
      this.waiters.set(guildId, pending);
    });
  }
}

/** Process-wide arbiter shared by the manager wiring and the sound engine gate. */
export const voiceOutputArbiter = new VoiceOutputArbiter();
