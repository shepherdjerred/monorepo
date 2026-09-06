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
  | "shutdown";

/** What the manager needs from an assistant-mode voice connection. */
export type AssistantConnection = AssistantVoiceConnection & {
  readonly receiver: VoiceReceiverLike;
};

type SessionLike = {
  accept: (audio: VoiceAudioInput) => void;
  abortActiveTransaction: (reason: string) => void;
  close: () => void;
};

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
  private readonly joinQueues = new Map<string, Promise<void>>();
  /**
   * Per-guild cancellation ticket for an in-flight join. `performJoin`
   * captures the value right before starting the (up to 30 s) connection
   * establishment; every teardown path bumps it via `endSession`. If the
   * value has moved by the time the connection resolves, a leave, flag
   * disable, empty-channel check, or shutdown arrived while this attempt was
   * establishing — the attempt tears down what it just built instead of
   * silently starting to listen after being told to stop.
   */
  private readonly epochs = new Map<string, number>();
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
   * Join the requester's voice channel and start listening. The caller has
   * already answered the user boundaries (flag, runtime, channel membership);
   * an unavailable runtime here is a broken internal contract.
   *
   * Joins are serialized per guild: two members racing `/scout join` before
   * the first connection resolves would otherwise both observe "no session",
   * and the second map write would strand the first session's lifecycle,
   * bridge, and inactivity timer un-closed — with that stale timer later able
   * to end the newer session. The second caller simply runs after the first.
   */
  async join(guildId: DiscordGuildId, channelId: string): Promise<void> {
    const previous = this.joinQueues.get(guildId);
    const run = (async () => {
      if (previous !== undefined) {
        try {
          await previous;
        } catch {
          // The earlier join's failure was already its own caller's answer;
          // this join starts from whatever state that attempt left behind.
        }
      }
      await this.performJoin(guildId, channelId);
    })();
    this.joinQueues.set(guildId, run);
    try {
      await run;
    } finally {
      if (this.joinQueues.get(guildId) === run) {
        this.joinQueues.delete(guildId);
      }
    }
  }

  private async performJoin(
    guildId: DiscordGuildId,
    channelId: string,
  ): Promise<void> {
    const runtime = this.deps.runtime();
    if (runtime === null) {
      throw new Error(
        "Voice assistant session requested without a bootstrapped runtime",
      );
    }
    const existing = this.sessions.get(guildId);
    if (existing !== undefined) {
      this.endSession(guildId, "rejoined", { leaveChannel: false });
    }
    const myEpoch = this.invalidate(guildId);
    const connection = await this.deps.joinAssistantChannel(guildId, channelId);
    if (this.epochs.get(guildId) !== myEpoch) {
      // A leave/flag-disable/empty-channel-check/shutdown ended this guild's
      // session (or lack thereof) while the connection was still
      // establishing. Tear down what this attempt just built and never
      // start listening — silently joining after being told to stop is
      // exactly the bug this ticket exists to prevent.
      this.deps.leaveChannel(guildId);
      logger.info(
        "voice assistant join abandoned: the guild's session ended before the connection was ready",
        { guildId },
      );
      return;
    }
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
  }

  /** `/scout leave`. Returns false when no session was active. */
  leave(guildId: string): boolean {
    return this.endSession(guildId, "leave-command", { leaveChannel: true });
  }

  /**
   * `voiceStateUpdate` hook: when the session's channel holds no non-bot
   * members any more, nobody consented to being listened to — leave.
   */
  handleVoiceStateUpdate(guildId: string): void {
    const active = this.sessions.get(guildId);
    if (active === undefined) return;
    const humans = this.deps.countHumanMembers(guildId, active.channelId);
    if (humans === null || humans > 0) return;
    this.endSession(guildId, "empty-channel", { leaveChannel: true });
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
 * so alerts wait for or duck under assistant speech instead of colliding.
 */
export function getVoiceAssistantManager(): VoiceAssistantManager {
  if (sharedManager === undefined) {
    sharedManager = new VoiceAssistantManager();
    voiceManager.setPlaybackGate(voiceOutputArbiter.playbackGate());
  }
  return sharedManager;
}
