import type { DuckObserver } from "@shepherdjerred/voice-assistant";
import type { PlaybackGate } from "#src/voice/voice-manager.ts";

const DEFAULT_ALERT_WAIT_MS = 2500;
const DUCKED_ALERT_VOLUME_MULTIPLIER = 0.3;

/**
 * Arbitrates the one voice connection's two audio producers: the assistant's
 * paced Opus reply and the sound-engine's alert playback.
 *
 * The assistant side is a per-guild speaking latch driven by the shared
 * sender's `DuckObserver` — `PacedAssistantSender` guarantees a
 * `duckChanged(false)` on every completion path (success, cancel, failure),
 * so the latch cannot stick. The sound-engine side is a bounded wait
 * (mutex) followed by ducked volume when the assistant is still talking:
 * an alert is never dropped, merely delayed briefly or played quietly.
 */
export class VoiceOutputArbiter {
  private readonly speakingGuilds = new Set<string>();
  private readonly waiters = new Map<string, (() => void)[]>();

  constructor(
    private readonly options: {
      readonly alertWaitMs?: number;
      readonly setTimer?: (callback: () => void, ms: number) => () => void;
    } = {},
  ) {}

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
   * waits briefly for the assistant to finish, then ducks the alert instead
   * of colliding at full volume. Restoration is structural — every alert
   * plays on a fresh audio resource, so the next quiet-time alert is back at
   * full volume with no state to unwind.
   */
  playbackGate(): PlaybackGate {
    return async (guildId) => {
      if (!this.speakingGuilds.has(guildId)) {
        return { volumeMultiplier: 1 };
      }
      await this.waitForQuiet(guildId);
      return this.speakingGuilds.has(guildId)
        ? { volumeMultiplier: DUCKED_ALERT_VOLUME_MULTIPLIER }
        : { volumeMultiplier: 1 };
    };
  }

  private waitForQuiet(guildId: string): Promise<void> {
    const waitMs = this.options.alertWaitMs ?? DEFAULT_ALERT_WAIT_MS;
    const setTimer =
      this.options.setTimer ??
      ((callback: () => void, ms: number) => {
        const timer = setTimeout(callback, ms);
        return () => {
          clearTimeout(timer);
        };
      });
    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        cancelTimer();
        resolve();
      };
      const pending = this.waiters.get(guildId) ?? [];
      pending.push(settle);
      this.waiters.set(guildId, pending);
      const cancelTimer = setTimer(settle, waitMs);
    });
  }
}

/** Process-wide arbiter shared by the manager wiring and the sound engine gate. */
export const voiceOutputArbiter = new VoiceOutputArbiter();
