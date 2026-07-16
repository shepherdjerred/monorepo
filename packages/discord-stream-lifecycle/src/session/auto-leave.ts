/**
 * Snapshot of voice channel occupancy at the moment of a `VoiceStateUpdate`. The caller
 * (game-bot) builds this from `client.channels.fetch(channelId)` + `members` filtered
 * to non-bots, non-self.
 */
export type VoiceOccupancySnapshot = {
  /** Guild whose voice channel state changed. */
  readonly guildId: string;
  /** The voice channel the session is bound to. */
  readonly voiceChannelId: string;
  /** Number of human members in `voiceChannelId` excluding the userbot itself. */
  readonly humanMemberCount: number;
};

export type AutoLeaveLogger = {
  info: (message: string, metadata?: Record<string, unknown>) => void;
};

const noopLogger: AutoLeaveLogger = {
  info: () => {
    /* silent default — consumers inject a real logger */
  },
};

export type AutoLeaveOptions = {
  /** Grace period before firing STOP when the channel goes empty. Default 30s. */
  readonly aloneGraceMs?: number;
  readonly logger?: AutoLeaveLogger;
};

/**
 * Single-session alone-in-voice grace timer. Pair one of these with a SessionManager:
 * - On every `VoiceStateUpdate` event, call `evaluate(snapshot)`.
 * - When the channel empties, a `aloneGraceMs` timer starts.
 * - If a human rejoins before the timer fires, it's cancelled.
 * - If the timer fires, `onShouldStop(session)` is invoked — typically
 *   `sessionManager.stop("aloneInVoice")`.
 *
 * Stateless across sessions: when a new session starts the timer is implicitly reset.
 */
export class AloneInVoiceWatcher {
  private readonly aloneGraceMs: number;
  private readonly log: AutoLeaveLogger;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private armedForSessionStartedAt: number | null = null;

  constructor(options: AutoLeaveOptions = {}) {
    this.aloneGraceMs = options.aloneGraceMs ?? 30_000;
    this.log = options.logger ?? noopLogger;
  }

  /**
   * Evaluate the current occupancy against the active session. No-op if the snapshot is
   * for a different guild or voice channel than the active session.
   */
  evaluate(
    session: { guildId: string; voiceChannelId: string; startedAt: Date },
    snapshot: VoiceOccupancySnapshot,
    onShouldStop: () => void,
  ): void {
    if (
      snapshot.guildId !== session.guildId ||
      snapshot.voiceChannelId !== session.voiceChannelId
    ) {
      return;
    }
    if (snapshot.humanMemberCount > 0) {
      this.cancel();
      return;
    }
    if (this.timer !== null) {
      // Already counting down for this empty-channel state.
      return;
    }
    const sessionToken = session.startedAt.getTime();
    this.armedForSessionStartedAt = sessionToken;
    this.log.info("voice channel empty; arming alone-grace timer", {
      guildId: session.guildId,
      voiceChannelId: session.voiceChannelId,
      aloneGraceMs: this.aloneGraceMs,
    });
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.armedForSessionStartedAt !== sessionToken) {
        // Session was replaced — let the new evaluator re-arm if needed.
        return;
      }
      this.armedForSessionStartedAt = null;
      onShouldStop();
    }, this.aloneGraceMs);
  }

  /** Cancel the pending timer (call when a human rejoins, or on session stop). */
  cancel(): void {
    if (this.timer === null) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = null;
    this.armedForSessionStartedAt = null;
  }

  /** True if a STOP timer is currently armed. */
  isArmed(): boolean {
    return this.timer !== null;
  }
}
