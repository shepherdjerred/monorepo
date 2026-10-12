import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  RESUME_CONFIRM_MS,
  type Session,
} from "@shepherdjerred/streambot/session/session-types.ts";
import type { RoomPersistence } from "@shepherdjerred/streambot/state/room-persistence.ts";
import {
  saveState,
  stateFilePath,
} from "@shepherdjerred/streambot/state/persistence.ts";
import {
  buildSnapshot,
  resumeKeyFor,
} from "@shepherdjerred/streambot/state/resume.ts";
import {
  playbackPositionSeconds,
  voiceReconnectsTotal,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
const log = logger.child("session-manager");
export async function writeSessionSnapshot(
  config: Config,
  session: Session,
  rooms: RoomPersistence,
): Promise<void> {
  // A checkpoint queued on the tail before teardown must not re-create the deleted state file.
  if (session.torndown) {
    return;
  }
  const { context } = session.actor.getSnapshot();
  const live = session.entry.userbot.getPosition();
  if (context.pausedPositionSeconds !== null) {
    session.lastKnownPositionSeconds = context.pausedPositionSeconds;
  } else if (context.current === null) {
    session.lastKnownPositionSeconds = 0;
  } else if (live !== null) {
    session.lastKnownPositionSeconds = live;
  }
  playbackPositionSeconds.set(session.lastKnownPositionSeconds);
  if (
    !session.resumeConfirmed &&
    Date.now() - session.bootAtMs >= RESUME_CONFIRM_MS
  ) {
    session.resumeConfirmed = true;
    // A confirmed session no longer needs voice-loss recovery scaffolding: count the recovery
    // as a success, reset the incident attempt counter, and let teardown delete state normally.
    if (session.recoveredFromVoiceLoss) {
      voiceReconnectsTotal.inc({ outcome: "success" });
      log.info("voice reconnect confirmed healthy", {
        guildId: session.guildId,
        channelId: session.voiceChannelId,
      });
    }
    session.reconnectAttempts = 0;
    session.preserveStateOnTeardown = false;
  }
  if (session.resumeConfirmed) {
    session.persistResumeKey =
      context.current === null ? null : resumeKeyFor(context.current.source);
    session.persistResumeAttempts = 0;
  }
  const state = buildSnapshot({
    context,
    positionSeconds: session.lastKnownPositionSeconds,
    savedAt: Date.now(),
    resumeKey: session.persistResumeKey,
    resumeAttempts: session.persistResumeAttempts,
    statusChannelId: session.statusChannelId,
  });
  try {
    if (
      session.playbackChannel !== undefined &&
      session.instanceId !== undefined
    ) {
      await rooms.update(session.playbackChannel, session.instanceId, state);
      return;
    }
    await saveState(
      stateFilePath(config.state.dir, session.guildId, session.voiceChannelId),
      state,
    );
  } catch (error) {
    log.error("failed to persist resume state", {
      guildId: session.guildId,
      channelId: session.voiceChannelId,
      error: getErrorMessage(error),
    });
  }
}
