import type { Announcement } from "@shepherdjerred/streambot/discord/status-reporter.ts";
import type { PlaybackEvent } from "@shepherdjerred/streambot/machine/types.ts";
import {
  voiceDisconnectsTotal,
  voiceReconnectsTotal,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import {
  deleteState,
  stateFilePath,
} from "@shepherdjerred/streambot/state/persistence.ts";
import type { VoiceCloseInfo } from "@shepherdjerred/streambot/streamer/streamer.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("voice-recovery");

/**
 * How recent a voice ws close must be to attribute a gateway-observed detach to it. The two
 * signals (fork `close` event, main-gateway voiceStateUpdate) arrive seconds apart at most;
 * anything older belongs to a previous incident.
 */
export const CLOSE_INFO_FRESHNESS_MS = 15_000;

export type VoiceLossClassification = {
  /** True when the loss was a deliberate removal (fresh 4014) — never auto-rejoin these. */
  readonly deliberate: boolean;
  /** Human-readable cause, used as the machine stop reason and in announcements. */
  readonly detail: string;
};

/**
 * Classify a voice-session loss. Deliberate ⇔ a *fresh* 4014 ("disconnected", e.g. a moderator
 * right-click → disconnect) was observed on the voice websocket. No close info (the gateway
 * reported the streamer leaving but the ws close never surfaced, or it is stale) defaults to
 * transient — worst case the bot rejoins once after a kick and the second, fresher 4014 lands
 * as deliberate.
 */
export function classifyVoiceLoss(
  close: VoiceCloseInfo | null,
  nowMs: number,
  freshnessMs: number = CLOSE_INFO_FRESHNESS_MS,
): VoiceLossClassification {
  if (close === null || nowMs - close.atMs > freshnessMs) {
    return {
      deliberate: false,
      detail: "voice connection lost (no close code observed)",
    };
  }
  if (close.deliberate) {
    return {
      deliberate: true,
      detail: `streamer was disconnected from voice (close code ${String(close.code)})`,
    };
  }
  return {
    deliberate: false,
    detail: `voice connection dropped (close code ${String(close.code)})`,
  };
}

/**
 * The stop reason dispatched into the playback machine (surfaced verbatim by the status
 * reporter's "⏹️ Stream stopped: …" announcement).
 */
export function voiceLossStopReason(
  classification: VoiceLossClassification,
  willReconnect: boolean,
): string {
  return willReconnect
    ? `${classification.detail} — reconnecting shortly`
    : classification.detail;
}

/** Announcement for when every reconnect attempt failed and the bot stays down. */
export function buildReconnectExhaustedAnnouncement(attempts: number): string {
  return (
    `❌ Couldn't reconnect after ${String(attempts)} attempt${attempts === 1 ? "" : "s"}. ` +
    `Playback state is saved — it will resume automatically on the next restart.`
  );
}

/** The slice of the streamer the coordinator reads: the latest Discord-side voice close. */
type CloseSource = { lastVoiceCloseInfo: () => VoiceCloseInfo | null };

/**
 * The slice of a session the coordinator drives. `SessionManager`'s `Session` satisfies this
 * structurally; the coordinator stays generic so it never needs the full (private) shape.
 */
export type RecoverableSession = {
  readonly key: string;
  readonly guildId: GuildId;
  readonly voiceChannelId: ChannelId;
  readonly statusChannelId: ChannelId | null;
  readonly entry: { readonly userbot: CloseSource };
  readonly actor: { send: (event: PlaybackEvent) => void };
  reconnectAttempts: number;
  preserveStateOnTeardown: boolean;
  voiceRecoveryStarted: boolean;
  readonly torndown: boolean;
};

export type ResumeOutcome =
  | "resumed"
  | "nothing"
  | "no-userbot"
  | "unresumable";

export type VoiceRecoveryCoordinatorDeps<TSession extends RecoverableSession> =
  {
    readonly reconnect: {
      readonly enabled: boolean;
      readonly delaySeconds: number;
      readonly maxAttempts: number;
    };
    readonly stateDir: string;
    readonly announce: (
      channelId: ChannelId | null,
      message: Announcement,
    ) => Promise<void>;
    /** Persist the session's live position (before the machine clears the queue). */
    readonly saveSnapshot: (session: TSession) => Promise<void>;
    readonly hasActiveSession: (key: string) => boolean;
    /** Respawn a `(guild, channel)` from its preserved state file (the reconnect-flavored resume). */
    readonly resumeOne: (
      guildId: GuildId,
      channelId: ChannelId,
      opts: { reconnectAttempts: number },
    ) => Promise<ResumeOutcome>;
  };

/** A scheduled reconnect attempt for a `(guild, channel)` whose session was lost to a voice drop. */
type PendingRecovery = {
  timer: ReturnType<typeof setTimeout>;
  /** Attempts already consumed before this scheduled one. */
  attempts: number;
  guildId: GuildId;
  channelId: ChannelId;
  statusChannelId: ChannelId | null;
  /** The userbot that owned the lost session — its lastVoiceCloseInfo is re-checked at fire time. */
  userbot: CloseSource;
};

/**
 * Owns the voice-loss incident lifecycle: classify → stop-with-reason (preserving resume state
 * for transient losses) → delayed, bounded reconnect attempts via the boot-resume machinery.
 */
export class VoiceRecoveryCoordinator<TSession extends RecoverableSession> {
  private readonly deps: VoiceRecoveryCoordinatorDeps<TSession>;
  /** One scheduled reconnect per `(guild, channel)` recovering from a transient voice loss. */
  private readonly pending = new Map<string, PendingRecovery>();

  constructor(deps: VoiceRecoveryCoordinatorDeps<TSession>) {
    this.deps = deps;
  }

  /**
   * Single entry point for a lost voice session (from either trigger — the fork's ws `close`
   * event or the main gateway's voiceStateUpdate). Classifies the loss, snapshots position,
   * stops the machine with a visible reason, and — for transient losses — schedules a
   * reconnect-with-resume.
   */
  async beginRecovery(session: TSession): Promise<void> {
    if (session.voiceRecoveryStarted || session.torndown) {
      return;
    }
    session.voiceRecoveryStarted = true;
    const classification = classifyVoiceLoss(
      session.entry.userbot.lastVoiceCloseInfo(),
      Date.now(),
    );
    voiceDisconnectsTotal.inc({
      deliberate: String(classification.deliberate),
    });
    const willReconnect =
      this.deps.reconnect.enabled && !classification.deliberate;
    log.warn("voice session lost", {
      guildId: session.guildId,
      channelId: session.voiceChannelId,
      deliberate: classification.deliberate,
      detail: classification.detail,
      willReconnect,
      priorAttempts: session.reconnectAttempts,
    });
    // Checkpoint BEFORE dispatching: the machine clears the queue on the external stop, and
    // teardown latches `torndown` which blocks later writes. Position is still live — the
    // wall-clock tracker keeps advancing until the player is stopped.
    await this.deps.saveSnapshot(session);
    session.preserveStateOnTeardown = willReconnect;
    session.actor.send({
      type: "STREAMER_VOICE_DETACHED",
      reason: voiceLossStopReason(classification, willReconnect),
    });
    if (!willReconnect) {
      return;
    }
    this.scheduleReconnect({
      key: session.key,
      guildId: session.guildId,
      channelId: session.voiceChannelId,
      statusChannelId: session.statusChannelId,
      attempts: session.reconnectAttempts,
      userbot: session.entry.userbot,
    });
  }

  /**
   * A recovery-spawned session died before proving healthy (e.g. the rejoin failed) without a
   * new voice-close incident of its own — count the failure and re-arm the retry loop.
   */
  rearmAfterFailedRecovery(session: TSession): void {
    voiceReconnectsTotal.inc({ outcome: "failed" });
    this.scheduleReconnect({
      key: session.key,
      guildId: session.guildId,
      channelId: session.voiceChannelId,
      statusChannelId: session.statusChannelId,
      attempts: session.reconnectAttempts,
      userbot: session.entry.userbot,
    });
  }

  /** Cancel every scheduled reconnect (process shutdown). */
  cancelAll(): void {
    for (const recovery of this.pending.values()) {
      clearTimeout(recovery.timer);
    }
    this.pending.clear();
  }

  /** Arm one delayed reconnect attempt, or give up (announcing) when attempts are exhausted. */
  private scheduleReconnect(params: {
    key: string;
    guildId: GuildId;
    channelId: ChannelId;
    statusChannelId: ChannelId | null;
    attempts: number;
    userbot: CloseSource;
  }): void {
    if (this.pending.has(params.key)) {
      return;
    }
    const { delaySeconds, maxAttempts } = this.deps.reconnect;
    if (params.attempts >= maxAttempts) {
      voiceReconnectsTotal.inc({ outcome: "exhausted" });
      log.error("voice reconnect attempts exhausted — staying down", {
        guildId: params.guildId,
        channelId: params.channelId,
        attempts: params.attempts,
      });
      void this.deps.announce(
        params.statusChannelId,
        buildReconnectExhaustedAnnouncement(params.attempts),
      );
      return;
    }
    const timer = setTimeout(() => {
      void this.attempt(params.key);
    }, delaySeconds * 1000);
    // Don't let a pending reconnect keep the process alive at shutdown.
    timer.unref();
    this.pending.set(params.key, {
      timer,
      attempts: params.attempts,
      guildId: params.guildId,
      channelId: params.channelId,
      statusChannelId: params.statusChannelId,
      userbot: params.userbot,
    });
  }

  /** Timer body: re-classify (a slow 4014 may have landed), then try one resume. */
  private async attempt(key: string): Promise<void> {
    const recovery = this.pending.get(key);
    if (recovery === undefined) {
      return;
    }
    this.pending.delete(key);
    if (this.deps.hasActiveSession(key)) {
      // The user re-played manually during the window — their session wins.
      log.info("skipping voice reconnect — session already active", {
        guildId: recovery.guildId,
        channelId: recovery.channelId,
      });
      voiceReconnectsTotal.inc({ outcome: "skipped" });
      return;
    }
    // Re-classify against the latest close info: the deliberate 4014 sometimes lands only after
    // the gateway detach that started this recovery. Widen freshness to cover the wait.
    const late = classifyVoiceLoss(
      recovery.userbot.lastVoiceCloseInfo(),
      Date.now(),
      this.deps.reconnect.delaySeconds * 1000 + CLOSE_INFO_FRESHNESS_MS,
    );
    if (late.deliberate) {
      log.warn("late deliberate disconnect — abandoning reconnect", {
        guildId: recovery.guildId,
        channelId: recovery.channelId,
        detail: late.detail,
      });
      voiceReconnectsTotal.inc({ outcome: "skipped" });
      await deleteState(
        stateFilePath(this.deps.stateDir, recovery.guildId, recovery.channelId),
      );
      await this.deps.announce(
        recovery.statusChannelId,
        `⏹️ ${late.detail} — staying disconnected.`,
      );
      return;
    }
    const attempt = recovery.attempts + 1;
    const result = await this.deps.resumeOne(
      recovery.guildId,
      recovery.channelId,
      { reconnectAttempts: attempt },
    );
    switch (result) {
      case "resumed":
        // Success is counted only once the recovered session streams healthily for the confirm
        // window (SessionManager.writeSnapshot); until then its teardown re-arms the retry.
        log.info("voice reconnect attempt respawned session", {
          guildId: recovery.guildId,
          channelId: recovery.channelId,
          attempt,
        });
        return;
      case "nothing":
        // Queue was empty (nothing left to resume) — a harmless, terminal no-op.
        voiceReconnectsTotal.inc({ outcome: "skipped" });
        return;
      case "unresumable":
        // No member userbot is registered for this guild — a structural, permanent condition
        // that the state file has already been dropped for. Distinct from the empty-queue case.
        voiceReconnectsTotal.inc({ outcome: "unresumable" });
        return;
      case "no-userbot":
        // A member userbot exists but is busy serving another stream (pool saturation). No rejoin
        // was attempted, so don't consume the reconnect budget — re-arm with the same attempt
        // count and wait for a slot to free up. The state file is preserved and naturally expires
        // via resumeMaxAgeSeconds, so this backs off on its own rather than looping forever.
        voiceReconnectsTotal.inc({ outcome: "no-userbot" });
        this.scheduleReconnect({
          key,
          guildId: recovery.guildId,
          channelId: recovery.channelId,
          statusChannelId: recovery.statusChannelId,
          attempts: recovery.attempts,
          userbot: recovery.userbot,
        });
    }
  }
}
