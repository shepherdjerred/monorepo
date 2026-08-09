/**
 * Reacts to `voiceStateUpdate` on behalf of the sessions: tracks where the streamer userbot is, and
 * leaves a voice channel once the last human has gone.
 *
 * Two distinct jobs share the event:
 *
 * 1. **Streamer topology** — the streamer being dragged to another channel (re-key the session),
 *    or vanishing entirely (hand to the voice-loss classifier, which decides kick vs transient).
 * 2. **Occupancy** — when a channel holds no real viewers, stop after a grace period so a brief
 *    solo moment or a reconnect blip doesn't drop playback.
 *
 * Split out of `command-bot.ts`, which is about commands and sits near the 500-line `max-lines` cap.
 */
import type { VoiceState } from "discord.js";
import { countRealViewers } from "@shepherdjerred/discord-stream-lifecycle/viewer-presence";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  type ChannelId,
  type GuildId,
  type UserId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("voice-topology");

/**
 * Grace period before leaving an empty voice channel, so a brief solo moment or a reconnect blip
 * doesn't drop playback (and an unattended e2e can stream to an empty channel).
 */
const ALONE_GRACE_MS = 30_000;

function parseVoiceChannelId(raw: string | null): ChannelId | null {
  if (raw === null) {
    return null;
  }
  const parsed = ChannelIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type VoiceTopologyDeps = {
  readonly getSessions: () => SessionManager;
  /**
   * Peer userbots (Pokébot, Glitter Kart) are real user accounts, so `user.bot` is false for them —
   * without this list they'd count as humans and the channel would never look empty.
   */
  readonly peerUserbotIds: readonly UserId[];
};

export class VoiceTopologyWatcher {
  private readonly deps: VoiceTopologyDeps;
  /** Pending "leave empty VC" timers, keyed by `guildId:channelId`. */
  private readonly aloneTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(deps: VoiceTopologyDeps) {
    this.deps = deps;
  }

  /** Cancel every pending leave timer (shutdown). */
  clearAll(): void {
    for (const timer of this.aloneTimers.values()) {
      clearTimeout(timer);
    }
    this.aloneTimers.clear();
  }

  handle(oldState: VoiceState, newState: VoiceState): void {
    const guildId = GuildIdSchema.safeParse(newState.guild.id);
    if (!guildId.success) {
      return;
    }
    const oldChannelId = parseVoiceChannelId(oldState.channelId);
    const newChannelId = parseVoiceChannelId(newState.channelId);
    if (
      this.handleStreamerTopology(
        guildId.data,
        newState.id,
        oldChannelId,
        newChannelId,
      )
    ) {
      return;
    }

    const candidates = new Set<ChannelId>();
    if (oldChannelId !== null) {
      candidates.add(oldChannelId);
    }
    if (newChannelId !== null) {
      candidates.add(newChannelId);
    }
    for (const channelId of candidates) {
      const meta = this.deps
        .getSessions()
        .activeSessionByChannel(guildId.data, channelId);
      if (meta === null) {
        continue;
      }
      this.evaluateOccupancy(guildId.data, channelId, newState, meta.userId);
    }
  }

  /** True when the event was about the streamer itself and has been fully handled. */
  private handleStreamerTopology(
    guildId: GuildId,
    userId: string,
    oldChannelId: ChannelId | null,
    newChannelId: ChannelId | null,
  ): boolean {
    const sessions = this.deps.getSessions();
    const oldMeta =
      oldChannelId === null
        ? null
        : sessions.activeSessionByChannel(guildId, oldChannelId);
    const newMeta =
      newChannelId === null
        ? null
        : sessions.activeSessionByChannel(guildId, newChannelId);
    if (oldMeta?.userId !== userId && newMeta?.userId !== userId) {
      return false;
    }

    if (
      oldChannelId !== null &&
      newChannelId !== null &&
      oldChannelId !== newChannelId
    ) {
      // Clearing the source timer is always safe: this session is leaving oldChannelId (and on a
      // collision it gets torn down). The destination timer must only be cleared on a SUCCESSFUL
      // move — if moveSession returns false because newChannelId already hosts a different session,
      // clearing its timer would strand that surviving session (alone but never leaving).
      this.clearAloneTimer(`${guildId}:${oldChannelId}`);
      const moved = sessions.moveSession({
        guildId,
        fromChannelId: oldChannelId,
        toChannelId: newChannelId,
      });
      if (moved) {
        this.clearAloneTimer(`${guildId}:${newChannelId}`);
      }
      return true;
    }

    if (oldChannelId !== null && newChannelId === null) {
      this.clearAloneTimer(`${guildId}:${oldChannelId}`);
      log.warn("streamer voice state went null — notifying session manager", {
        guildId,
        channelId: oldChannelId,
      });
      // The session manager classifies the loss (kick vs transient) via the voice ws close code
      // and decides whether to stay down or reconnect-with-resume.
      sessions.notifyStreamerDetached({ guildId, channelId: oldChannelId });
      return true;
    }

    if (newChannelId !== null) {
      this.clearAloneTimer(`${guildId}:${newChannelId}`);
    }
    return true;
  }

  private evaluateOccupancy(
    guildId: GuildId,
    channelId: ChannelId,
    state: VoiceState,
    streamerId: string | null,
  ): void {
    const channel = state.guild.channels.cache.get(channelId);
    if (channel?.isVoiceBased() !== true) {
      return;
    }
    const voiceStates = channel.guild.voiceStates.cache;
    const humanCount = countRealViewers(
      channel.members.map((member) => {
        const memberState = voiceStates.get(member.id);
        return {
          id: member.id,
          isBot: member.user.bot,
          streaming: memberState?.streaming ?? false,
          selfDeaf: memberState?.selfDeaf ?? false,
          selfMute: memberState?.selfMute ?? false,
        };
      }),
      { selfUserId: streamerId, peerUserbotIds: this.deps.peerUserbotIds },
    );
    const key = `${guildId}:${channelId}`;
    if (humanCount > 0) {
      this.clearAloneTimer(key);
      return;
    }
    if (this.aloneTimers.has(key)) {
      return;
    }
    // Alone in the VC. Leave after a grace period (cancelled if a human (re)joins), rather than
    // dropping playback the instant the channel empties.
    const timer = setTimeout(() => {
      this.aloneTimers.delete(key);
      log.info("voice channel empty for grace period — stopping", {
        guildId,
        channelId,
      });
      this.deps
        .getSessions()
        .getExisting(guildId, channelId)
        ?.dispatch({ type: "STOP" });
    }, ALONE_GRACE_MS);
    this.aloneTimers.set(key, timer);
  }

  private clearAloneTimer(key: string): void {
    const timer = this.aloneTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.aloneTimers.delete(key);
    }
  }
}
