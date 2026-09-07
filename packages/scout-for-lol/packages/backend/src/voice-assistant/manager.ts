import { DiscordGuildIdSchema, type DiscordGuildId } from "@scout-for-lol/data";
import type { VoiceAudioInput } from "@shepherdjerred/voice-assistant";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { voiceManager, type ConnectionMode } from "#src/voice/voice-manager.ts";
import {
  getVoiceAssistantRuntime,
  type VoiceAssistantRuntime,
} from "#src/voice-assistant/runtime.ts";
import {
  ScoutVoiceSession,
  type VoiceQuestionObservation,
} from "#src/voice-assistant/session.ts";
import {
  VoiceReceiverBridge,
  type VoiceReceiverLike,
} from "#src/voice-assistant/receiver-bridge.ts";
import {
  createAssistantSender,
  type AssistantVoiceConnection,
} from "#src/voice-assistant/assistant-sender.ts";
import { voiceOutputArbiter } from "#src/voice-assistant/output-arbiter.ts";
import { VOICE_INACTIVITY_TIMEOUT_MS } from "#src/voice-assistant/constants.ts";
import { captureVoiceQuestionAsked } from "#src/analytics/voice-question.ts";
import {
  scoutVoiceActiveSessions,
  scoutVoiceSessionsTotal,
} from "#src/metrics/voice.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("voice-assistant-manager");

export type SessionEndReason =
  | "leave-command"
  | "inactivity"
  | "empty-channel"
  | "connection-lost"
  | "rejoined"
  | "flag-disabled"
  | "shutdown"
  | "moved";

/** What the manager needs from an assistant-mode voice connection. */
export type AssistantConnection = AssistantVoiceConnection & {
  readonly receiver: VoiceReceiverLike;
};

type SessionLike = {
  accept: (audio: VoiceAudioInput) => void;
  abortActiveTransaction: (reason: string) => void;
  close: () => void;
};

/**
 * `"cancelled"` means a leave/flag-disable/empty-channel-check/shutdown/newer
 * join ended this guild's session — or an earlier queued attempt for it —
 * before this request ever started listening. A genuine connection failure
 * still throws; this is never returned for one.
 */
export type VoiceJoinOutcome = "joined" | "cancelled";

export type VoiceAssistantManagerDeps = {
  readonly runtime: () => VoiceAssistantRuntime | null;
  readonly joinAssistantChannel: (
    guildId: string,
    channelId: string,
  ) => Promise<AssistantConnection>;
  readonly leaveChannel: (guildId: string) => void;
  readonly onConnectionLost: (
    listener: (guildId: string, mode: ConnectionMode) => void,
  ) => void;
  /**
   * Unknown users count as human: refusing audio on a cache miss would
   * silently deafen the assistant to real speakers, while a bot slipping
   * through only reaches the local wake cascade.
   */
  readonly isHumanUser: (userId: string) => boolean;
  /** Null when the channel cannot be resolved (skip the empty-channel check). */
  readonly countHumanMembers: (
    guildId: string,
    channelId: string,
  ) => number | null;
  readonly createSession: (input: {
    guildId: string;
    runtime: VoiceAssistantRuntime;
    connection: AssistantConnection;
    onWakeAccepted: () => void;
    onQuestionObserved: (observation: VoiceQuestionObservation) => void;
  }) => SessionLike;
  readonly setTimer: (callback: () => void, ms: number) => () => void;
  readonly captureQuestion: (
    guildId: string,
    observation: VoiceQuestionObservation,
  ) => void;
  /** Whether `voice_assistant_enabled` currently holds for this guild. */
  readonly isGuildEnabled: (guildId: string) => Promise<boolean>;
};

type ActiveSession = {
  readonly guildId: string;
  readonly channelId: string;
  readonly session: SessionLike;
  readonly bridge: VoiceReceiverBridge;
  cancelInactivityTimer: () => void;
};

function defaultDeps(): VoiceAssistantManagerDeps {
  return {
    runtime: getVoiceAssistantRuntime,
    joinAssistantChannel: async (guildId, channelId) =>
      await voiceManager.joinChannel(guildId, channelId, "assistant"),
    leaveChannel: (guildId) => {
      voiceManager.leaveChannel(guildId);
    },
    onConnectionLost: (listener) => {
      voiceManager.onConnectionLost(listener);
    },
    isHumanUser: (userId) =>
      voiceManager.getClient()?.users.cache.get(userId)?.bot !== true,
    countHumanMembers: (guildId, channelId) => {
      const channel = voiceManager
        .getClient()
        ?.guilds.cache.get(guildId)
        ?.channels.cache.get(channelId);
      if (channel?.isVoiceBased() !== true) return null;
      return channel.members.filter((member) => !member.user.bot).size;
    },
    createSession: (input) =>
      new ScoutVoiceSession({
        guildId: input.guildId,
        models: input.runtime.models,
        openAiApiKey: input.runtime.openAiApiKey,
        feedbackClips: input.runtime.feedbackClips,
        createAssistantAudio: () =>
          createAssistantSender(
            input.connection,
            voiceOutputArbiter.assistantDuck(input.guildId),
            () => voiceOutputArbiter.reserveForAssistant(input.guildId),
          ),
        onWakeAccepted: input.onWakeAccepted,
        onQuestionObserved: input.onQuestionObserved,
      }),
    setTimer: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => {
        clearTimeout(timer);
      };
    },
    captureQuestion: (guildId, observation) => {
      void captureVoiceQuestionAsked({ guildId, observation });
    },
    isGuildEnabled: async (guildId) =>
      await isPolicyEnabled("voice_assistant_enabled", {
        server: DiscordGuildIdSchema.parse(guildId),
      }),
  };
}

/**
 * Per-guild Hey Scout session registry and every teardown path: `/scout
 * leave`, the 45-minute no-wake inactivity timer (reset on each locally
 * accepted wake), the empty-channel check on `voiceStateUpdate`, connection
 * loss, and process shutdown. Sessions exist only where an explicit `/scout
 * join` created one.
 */
export class VoiceAssistantManager {
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly joinQueues = new Map<string, Promise<unknown>>();
  /**
   * Per-guild cancellation ticket. `join()` captures it at enqueue time (to
   * catch a teardown that lands while THIS request is still queued behind an
   * earlier one) and `performJoin` captures a fresh value again right before
   * starting the (up to 30 s) connection establishment (to catch one that
   * lands while THIS request is establishing). Every teardown path bumps it
   * via `endSession`, and `handleVoiceStateUpdate` also bumps it directly for
   * a pending join whose target channel is already empty. If either captured
   * value is stale by the time it's checked, the request is abandoned
   * instead of silently starting to listen after being told to stop.
   */
  private readonly epochs = new Map<string, number>();
  /** Guild -> channel a join is currently establishing a connection for. */
  private readonly pendingJoinChannels = new Map<string, string>();
  /** Set once by `closeAll()`; never cleared — the process is exiting. */
  private closed = false;
  private readonly deps: VoiceAssistantManagerDeps;

  constructor(deps: VoiceAssistantManagerDeps = defaultDeps()) {
    this.deps = deps;
    this.deps.onConnectionLost((guildId, mode) => {
      if (mode !== "assistant") return;
      this.endSession(guildId, "connection-lost", { leaveChannel: false });
    });
  }

  isActive(guildId: string): boolean {
    return this.sessions.has(guildId);
  }

  activeChannelId(guildId: string): string | undefined {
    return this.sessions.get(guildId)?.channelId;
  }

  /**
   * Snapshot this guild's cancellation ticket for a caller that must itself
   * await gates (flag lookup, deferred reply) before it can call `join()`.
   * Those awaits happen entirely before `join()` is ever invoked, so they
   * sit outside the queue's own epoch protection — a `/scout leave` landing
   * in that gap would otherwise be invisible to the join that follows.
   * Capture this as the first synchronous step, before any such await, and
   * pass it to `join()`'s `expectedEpoch` parameter.
   */
  captureJoinEpoch(guildId: string): number {
    return this.currentEpoch(guildId);
  }

  /**
   * Join the requester's voice channel and start listening. The caller has
   * already answered the user boundaries (flag, runtime, channel membership);
   * an unavailable runtime here is a broken internal contract.
   *
   * Joins are serialized per guild: two members racing `/scout join` before
   * the first connection resolves would otherwise both observe "no session",
   * and the second map write would strand the first session's lifecycle,
   * bridge, and inactivity timer un-closed — with that stale timer later able
   * to end the newer session. The second caller simply runs after the first.
   *
   * @param expectedEpoch From `captureJoinEpoch()`, taken before the
   * caller's own pre-`join()` awaits. A mismatch means a
   * leave/flag-disable/newer-join ended this guild's session during that
   * gap — cancel exactly as if this request had been sitting in the queue
   * the whole time.
   */
  async join(
    guildId: DiscordGuildId,
    channelId: string,
    expectedEpoch?: number,
  ): Promise<VoiceJoinOutcome> {
    if (this.closed) {
      // `closeAll()` is a one-time sweep of what exists AT THAT MOMENT; a
      // command that arrives (or finishes its own flag/runtime checks) any
      // time afterward — during the rest of process shutdown, while Discord
      // is still connected — must never be allowed to start a new session
      // that then keeps receiving audio through the remaining drain.
      logger.info("voice assistant join refused: manager is shutting down", {
        guildId,
      });
      return "cancelled";
    }
    if (
      expectedEpoch !== undefined &&
      this.currentEpoch(guildId) !== expectedEpoch
    ) {
      // Nothing has been committed to yet at this point (no rejoin
      // teardown, no pendingJoinChannels entry) — unlike the checks inside
      // `performJoin`, there is nothing of this attempt's own to leave.
      logger.info(
        "voice assistant join cancelled: the guild's session ended before this request entered the queue",
        { guildId },
      );
      return "cancelled";
    }
    const enqueuedEpoch = this.currentEpoch(guildId);
    const previous = this.joinQueues.get(guildId);
    const run: Promise<VoiceJoinOutcome> = (async () => {
      if (previous !== undefined) {
        try {
          await previous;
        } catch {
          // The earlier join's failure was already its own caller's answer;
          // this join starts from whatever state that attempt left behind.
        }
      }
      if (this.currentEpoch(guildId) !== enqueuedEpoch) {
        // A leave/flag-disable/empty-channel-check/shutdown/newer join ended
        // this guild's session (or an earlier queued attempt for it) while
        // this request was waiting its turn. A request that predates a stop
        // must never start listening after it — even though it never itself
        // began establishing a connection.
        logger.info("voice assistant join cancelled while queued", {
          guildId,
        });
        return "cancelled";
      }
      return await this.performJoin(guildId, channelId);
    })();
    this.joinQueues.set(guildId, run);
    try {
      return await run;
    } finally {
      if (this.joinQueues.get(guildId) === run) {
        this.joinQueues.delete(guildId);
      }
    }
  }

  private async performJoin(
    guildId: DiscordGuildId,
    channelId: string,
  ): Promise<VoiceJoinOutcome> {
    const runtime = this.deps.runtime();
    if (runtime === null) {
      throw new Error(
        "Voice assistant session requested without a bootstrapped runtime",
      );
    }
    // Revalidate occupancy right as this request reaches the head of the
    // queue, before touching any existing session — a request about to be
    // cancelled must never tear down a session that was actually fine. This
    // is a plain synchronous read (`countHumanMembers` never awaits), which
    // matters for what follows: it introduces no async gap before `myEpoch`
    // is captured below.
    const startingHumans = this.deps.countHumanMembers(guildId, channelId);
    if (startingHumans === 0) {
      logger.info(
        "voice assistant join cancelled: target channel is already empty",
        { guildId, channelId },
      );
      return "cancelled";
    }
    const existing = this.sessions.get(guildId);
    if (existing !== undefined) {
      this.endSession(guildId, "rejoined", { leaveChannel: false });
    }
    // Capture the epoch SYNCHRONOUSLY here, immediately after any
    // self-inflicted "rejoined" bump above and before any `await`. A join
    // queued behind this one captures its OWN starting epoch the moment
    // `join()` is called — synchronously, right after THIS `join()` call
    // returns — so this attempt's own bump (including "rejoined"'s) must
    // already have happened by then, or the next queued join would
    // misread this attempt's normal commitment as an external
    // invalidation it needs to react to.
    const myEpoch = this.invalidate(guildId);
    // Set before any async gap too, for the same reason `handleVoiceStateUpdate`
    // needs a channel to inspect for the ENTIRE rest of this attempt — flag
    // check included — not only during the connection establishment below.
    this.pendingJoinChannels.set(guildId, channelId);
    try {
      // Recheck the guild flag right as this request reaches the head of the
      // queue: `closeDisabledGuildSessions()` snapshots `sessions`/
      // `joinQueues` at the moment it runs, so a join that had not yet
      // entered `joinQueues` when the flag turned off is invisible to that
      // snapshot, and the command handler's own check (scout-voice.ts) only
      // ran once, before this request was even enqueued. Safe to make this
      // the first async gap: `myEpoch` is already captured, so anything that
      // invalidates the guild during this await (including a bare `leave()`,
      // which changes nothing a flag/occupancy check alone would see) is
      // still caught by the epoch comparison below.
      let startingEnabled: boolean;
      try {
        startingEnabled = await this.deps.isGuildEnabled(guildId);
      } catch (error) {
        // isPolicyEnabled() already resolves an absent-or-not-ready flag
        // silently through its local default; anything that still throws
        // here is a malformed or otherwise broken authoritative result.
        // Trusting that as authorization to start an undeafened listening
        // session would treat corrupt data as consent — fail closed.
        logger.warn(
          "voice flag re-check failed to evaluate a guild; cancelling the join",
          {
            guildId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        this.deps.leaveChannel(guildId);
        return "cancelled";
      }
      if (!startingEnabled || this.epochs.get(guildId) !== myEpoch) {
        // Tear down whatever this attempt already committed to — the
        // "rejoined" teardown above may have ended a session without
        // leaving the channel, expecting THIS attempt to replace the
        // connection; nobody else will if it never gets there.
        this.deps.leaveChannel(guildId);
        logger.info(
          startingEnabled
            ? "voice assistant join abandoned: the guild's session ended while checking the flag"
            : "voice assistant join cancelled: the guild flag is disabled",
          { guildId },
        );
        return "cancelled";
      }

      const connection = await this.deps.joinAssistantChannel(
        guildId,
        channelId,
      );
      // Recheck again after the (up to 30 s) connection establishment: the
      // epoch catches every teardown path that calls
      // `endSession`/`invalidate` directly, but a flag disable or an
      // emptied channel needs its own direct recheck too rather than
      // depending solely on the next periodic sweep to notice.
      const finalEligibility = await this.isJoinStillEligible(
        guildId,
        channelId,
      );
      if (this.epochs.get(guildId) !== myEpoch || !finalEligibility.eligible) {
        // A leave/flag-disable/empty-channel-check/shutdown ended this
        // guild's session (or lack thereof) while the connection was still
        // establishing. Tear down what this attempt just built and never
        // start listening — silently joining after being told to stop is
        // exactly the bug this ticket exists to prevent.
        this.deps.leaveChannel(guildId);
        logger.info(
          finalEligibility.eligible
            ? "voice assistant join abandoned: the guild's session ended before the connection was ready"
            : `voice assistant join abandoned: ${finalEligibility.reason}`,
          { guildId },
        );
        return "cancelled";
      }
      return this.createJoinedSession(guildId, channelId, runtime, connection);
    } finally {
      if (this.pendingJoinChannels.get(guildId) === channelId) {
        this.pendingJoinChannels.delete(guildId);
      }
    }
  }

  private createJoinedSession(
    guildId: DiscordGuildId,
    channelId: string,
    runtime: VoiceAssistantRuntime,
    connection: AssistantConnection,
  ): VoiceJoinOutcome {
    const session = this.deps.createSession({
      guildId,
      runtime,
      connection,
      // Fires only once audio flows, which is strictly after the map insert
      // below — the guild lookup can never miss its own session.
      onWakeAccepted: () => {
        this.resetInactivityTimer(guildId);
      },
      onQuestionObserved: (observation) => {
        this.deps.captureQuestion(guildId, observation);
      },
    });
    const bridge = new VoiceReceiverBridge({
      receiver: connection.receiver,
      accept: (audio) => {
        session.accept(audio);
      },
      isHumanUser: this.deps.isHumanUser,
    });
    this.sessions.set(guildId, {
      guildId,
      channelId,
      session,
      bridge,
      cancelInactivityTimer: () => {
        /* replaced by resetInactivityTimer below */
      },
    });
    this.resetInactivityTimer(guildId);
    scoutVoiceActiveSessions.inc();
    scoutVoiceSessionsTotal.inc({ event: "started", reason: "join" });
    logger.info("voice assistant session started", { guildId, channelId });
    return "joined";
  }

  /** `/scout leave`. Returns false when no session was active. */
  leave(guildId: string): boolean {
    return this.endSession(guildId, "leave-command", { leaveChannel: true });
  }

  /**
   * `voiceStateUpdate` hook: when the relevant channel holds no non-bot
   * members any more, nobody consented to being listened to — leave.
   *
   * Also covers a join still establishing its connection: if the requester
   * (or everyone else) leaves the target channel before Discord finishes
   * handshaking, there is no session yet for the realized-session branch to
   * end, and nothing else would ever recheck this specific channel again — a
   * later voiceStateUpdate elsewhere in the guild, or in this channel once
   * some UNRELATED member joins, would see a non-empty count and never
   * trigger this method's early return path. Bumping the epoch here lets
   * `performJoin`'s own check catch it once the connection resolves, instead
   * of Scout starting to listen alone for up to 45 minutes.
   */
  handleVoiceStateUpdate(guildId: string): void {
    const active = this.sessions.get(guildId);
    const pendingChannelId = this.pendingJoinChannels.get(guildId);
    const channelId = active?.channelId ?? pendingChannelId;
    if (channelId === undefined) return;
    const humans = this.deps.countHumanMembers(guildId, channelId);
    if (humans === null || humans > 0) return;
    if (active !== undefined) {
      this.endSession(guildId, "empty-channel", { leaveChannel: true });
      return;
    }
    this.invalidate(guildId);
  }

  /**
   * Discord's own `VoiceStateUpdate` for Scout's own member: `newChannelId`
   * is wherever the underlying connection is bound now (`null` if
   * disconnected). An admin dragging the bot to a different channel moves
   * that connection without ever going through `join()` — nobody consented
   * to being listened to there, and the stored channel ID here would
   * otherwise keep pointing at the channel Scout just left, so the
   * empty-channel check above (and any later teardown) would keep watching
   * the wrong room. A bare disconnect is already handled by the
   * connection-lost listener wired in the constructor; this only needs to
   * act on a channel ID that changed to something else the manager didn't
   * request.
   */
  handleBotChannelChanged(guildId: string, newChannelId: string | null): void {
    const active = this.sessions.get(guildId);
    const pendingChannelId = this.pendingJoinChannels.get(guildId);
    const knownChannelId = active?.channelId ?? pendingChannelId;
    if (knownChannelId === undefined || knownChannelId === newChannelId) {
      return;
    }
    if (active !== undefined) {
      this.endSession(guildId, "moved", { leaveChannel: true });
      return;
    }
    this.invalidate(guildId);
  }

  /**
   * Dynamic-config refresh hook: an operator switching
   * `voice_assistant_enabled` off must stop active capture, not merely hide
   * the commands — the same refresh removes `/scout leave` from the guild's
   * picker, so without this sweep an active session would keep listening with
   * no command left to stop it.
   */
  async closeDisabledGuildSessions(): Promise<void> {
    // Snapshot: entries are deleted across awaits while this iterates. Union
    // in guilds with an in-flight join (not yet in `sessions`) so a pending
    // `/scout join` in a guild whose flag just went false is invalidated too
    // — see `performJoin`'s epoch check.
    const activeGuildIds = [
      ...new Set([...this.sessions.keys(), ...this.joinQueues.keys()]),
    ];
    for (const guildId of activeGuildIds) {
      let enabled: boolean;
      try {
        enabled = await this.deps.isGuildEnabled(guildId);
      } catch (error) {
        // A flag-evaluation failure is not an answer; keep the session and
        // let the next refresh try again rather than tearing down consent
        // the operator did not revoke.
        logger.warn("voice flag sweep could not evaluate a guild", {
          guildId,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (enabled) continue;
      this.endSession(guildId, "flag-disabled", { leaveChannel: true });
    }
  }

  closeAll(): void {
    // Marked FIRST and permanently: this is a one-time sweep of whatever
    // exists at this exact moment, but shutdown's remaining drain (Temporal,
    // worker, HTTP) can take real time with Discord still connected, and a
    // /scout join arriving — or finishing its own flag/runtime checks —
    // any time during that window must never be allowed to start a brand
    // new session. `join()` checks this before it does anything else.
    this.closed = true;
    // Union with in-flight joins for the same reason as the flag sweep: a
    // pending `/scout join` must not silently complete after shutdown.
    const guildIds = new Set([
      ...this.sessions.keys(),
      ...this.joinQueues.keys(),
    ]);
    for (const guildId of guildIds) {
      this.endSession(guildId, "shutdown", { leaveChannel: true });
    }
  }

  private resetInactivityTimer(guildId: string): void {
    const active = this.sessions.get(guildId);
    if (active === undefined) return;
    active.cancelInactivityTimer();
    active.cancelInactivityTimer = this.deps.setTimer(() => {
      this.endSession(guildId, "inactivity", { leaveChannel: true });
    }, VOICE_INACTIVITY_TIMEOUT_MS);
  }

  /**
   * Bump the guild's join ticket, invalidating any `performJoin` currently
   * awaiting its connection. Called unconditionally at the top of
   * `endSession` — including when there is no active session yet — so a
   * pending join is cancelled by the same teardown paths that would have
   * ended it had it already started.
   */
  private invalidate(guildId: string): number {
    const next = (this.epochs.get(guildId) ?? 0) + 1;
    this.epochs.set(guildId, next);
    return next;
  }

  /** Read the guild's ticket without bumping it. */
  private currentEpoch(guildId: string): number {
    return this.epochs.get(guildId) ?? 0;
  }

  /**
   * Whether a join for `channelId` in `guildId` may still proceed right now:
   * the guild flag is enabled AND the target channel is not already known to
   * be empty. `performJoin` calls this both at the head of the queue and
   * again after the connection resolves — see its call sites for why a
   * single check at either point is not enough on its own.
   */
  private async isJoinStillEligible(
    guildId: string,
    channelId: string,
  ): Promise<{ eligible: true } | { eligible: false; reason: string }> {
    let enabled: boolean;
    try {
      enabled = await this.deps.isGuildEnabled(guildId);
    } catch (error) {
      // Same reasoning as performJoin's starting-flag recheck: a thrown
      // evaluation is a broken authoritative result, not a mere hiccup —
      // fail closed rather than trust it as authorization to keep
      // listening.
      logger.warn(
        "voice flag re-check failed to evaluate a guild; cancelling the join",
        {
          guildId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return {
        eligible: false,
        reason: "the guild flag could not be evaluated",
      };
    }
    if (!enabled) {
      return { eligible: false, reason: "the guild flag is disabled" };
    }
    const humans = this.deps.countHumanMembers(guildId, channelId);
    if (humans === 0) {
      return {
        eligible: false,
        reason: "the target channel is already empty",
      };
    }
    return { eligible: true };
  }

  private endSession(
    guildId: string,
    reason: SessionEndReason,
    options: { leaveChannel: boolean },
  ): boolean {
    this.invalidate(guildId);
    const active = this.sessions.get(guildId);
    if (active === undefined) return false;
    this.sessions.delete(guildId);
    active.cancelInactivityTimer();
    active.session.abortActiveTransaction(
      `Voice assistant session ended: ${reason}`,
    );
    active.bridge.close();
    active.session.close();
    if (options.leaveChannel) {
      this.deps.leaveChannel(guildId);
    }
    scoutVoiceActiveSessions.dec();
    scoutVoiceSessionsTotal.inc({ event: "ended", reason });
    logger.info("voice assistant session ended", { guildId, reason });
    return true;
  }
}

let sharedManager: VoiceAssistantManager | undefined;

/**
 * Lazy singleton. First access wires the whole integration: the
 * connection-lost listener (constructor) and the sound-engine playback gate,
 * so alerts wait for assistant speech to fall fully silent instead of
 * colliding on the connection's one outbound Opus stream.
 */
export function getVoiceAssistantManager(): VoiceAssistantManager {
  if (sharedManager === undefined) {
    sharedManager = new VoiceAssistantManager();
    voiceManager.setPlaybackGate(voiceOutputArbiter.playbackGate());
  }
  return sharedManager;
}
