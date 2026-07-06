import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { Announcement } from "@shepherdjerred/streambot/discord/status-reporter.ts";
import type { PlaybackInput } from "@shepherdjerred/streambot/machine/types.ts";
import type { UserbotProvider } from "@shepherdjerred/streambot/pool/userbot-pool.ts";
import {
  MAX_RESUME_ATTEMPTS,
  type Session,
  type SpawnParams,
} from "@shepherdjerred/streambot/session/session-types.ts";
import type { ResumeOutcome } from "@shepherdjerred/streambot/session/voice-recovery.ts";
import {
  deleteState,
  loadState,
  stateFilePath,
} from "@shepherdjerred/streambot/state/persistence.ts";
import {
  buildResumeAnnouncement,
  buildResumeInput,
} from "@shepherdjerred/streambot/state/resume.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("session-manager");

export type ResumeRunnerDeps = {
  readonly config: Config;
  readonly pool: UserbotProvider;
  readonly announce: (
    channelId: ChannelId | null,
    message: Announcement,
  ) => Promise<void>;
  readonly spawn: (params: SpawnParams) => Session;
};

/**
 * Load, decide, and respawn one persisted `(guild, channel)` session. Shared between boot
 * (`SessionManager.resumeAll`) and the voice-loss reconnect path
 * (`VoiceRecoveryCoordinator.attempt`).
 */
export async function resumeSession(
  deps: ResumeRunnerDeps,
  guildId: GuildId,
  channelId: ChannelId,
  opts: { origin: "boot" | "reconnect"; reconnectAttempts?: number },
): Promise<ResumeOutcome> {
  const stateDir = deps.config.state.dir;
  const filePath = stateFilePath(stateDir, guildId, channelId);
  const restored = await loadState(
    filePath,
    deps.config.state.resumeMaxAgeSeconds,
  );
  if (restored === null) {
    await deleteState(filePath);
    return "nothing";
  }
  const base: PlaybackInput = {
    guildId,
    channelId,
    idleTimeoutMs: deps.config.idleTimeoutSeconds * 1000,
  };
  const decision = buildResumeInput(restored, base, {
    maxResumeAttempts: MAX_RESUME_ATTEMPTS,
  });
  const hasSomething = (decision.input.initialQueue?.length ?? 0) > 0;
  if (!hasSomething) {
    await deleteState(filePath);
    return "nothing";
  }
  const entry = deps.pool.acquire(guildId);
  if (entry === null) {
    if (deps.pool.canServe(guildId)) {
      // A member userbot exists but is busy — keep the file and retry later (next boot, or the
      // next reconnect attempt; loadState enforces resumeMaxAgeSeconds either way).
      log.warn("no userbot free to resume session (will retry)", {
        guildId,
        channelId,
      });
      return "no-userbot";
    }
    // No pooled userbot is a member of this guild, so it can never be resumed — drop the stale
    // file instead of letting it accumulate until expiry.
    log.warn("dropping unresumable session (no member userbot)", {
      guildId,
      channelId,
    });
    await deleteState(filePath);
    return "unresumable";
  }
  const session = deps.spawn({
    guildId,
    voiceChannelId: channelId,
    statusChannelId: restored.statusChannelId,
    entry,
    input: decision.input,
    resumeKey: decision.resumeKey,
    resumeAttempts: decision.resumeAttempts,
    seekSeconds: decision.input.initialSeekSeconds ?? 0,
    ...(opts.origin === "reconnect"
      ? {
          recoveredFromVoiceLoss: true,
          reconnectAttempts: opts.reconnectAttempts ?? 1,
          // Keep the state file until this recovery proves healthy (resumeConfirmed), so a
          // failed rejoin can retry instead of losing the movie.
          preserveStateOnTeardown: true,
        }
      : {}),
  });
  log.info("resumed session", {
    guildId,
    channelId,
    origin: opts.origin,
    resumedCurrent: decision.resumedCurrent,
    droppedForCrashLoop: decision.droppedForCrashLoop,
  });
  const announcement = buildResumeAnnouncement(restored, decision);
  if (announcement !== null) {
    await deps.announce(session.statusChannelId, announcement);
  }
  return "resumed";
}
