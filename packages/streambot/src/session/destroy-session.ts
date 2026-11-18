import { deleteSessionStateAfterFlush } from "@shepherdjerred/streambot/session/delete-session-state.ts";
import type { NumberedSessions } from "@shepherdjerred/streambot/session/numbered-sessions.ts";
import {
  keyOf,
  type Session,
  type SessionManagerDeps,
} from "@shepherdjerred/streambot/session/session-types.ts";
import { describeSnapshot } from "@shepherdjerred/streambot/session/status-snapshot.ts";
import type { VoiceRecoveryCoordinator } from "@shepherdjerred/streambot/session/voice-recovery.ts";
import type { StationFeeder } from "@shepherdjerred/streambot/station/station-feeder.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import type { PlaybackChannelNumber } from "@shepherdjerred/streambot/types/playback-channel.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("session-manager");

export function releaseUnusedSession(
  sessions: ReadonlyMap<string, Session>,
  guildId: GuildId,
  channelId: ChannelId,
  playbackChannel?: PlaybackChannelNumber,
): void {
  const session = sessions.get(keyOf(guildId, channelId, playbackChannel));
  if (session === undefined || session.hasStarted) return;
  const snapshot = session.actor.getSnapshot();
  const { stateName } = describeSnapshot(snapshot);
  if (
    stateName !== "idle" ||
    snapshot.context.current !== null ||
    snapshot.context.queue.length > 0 ||
    session.station !== undefined
  ) {
    return;
  }
  session.teardownHold.request();
}

async function destroySession(
  session: Session,
  saveSnapshot: (session: Session) => Promise<void>,
  onAbortStation?: () => void,
): Promise<void> {
  session.entry.userbot.setVoiceCloseListener(null);
  session.entry.userbot.setStallListener(null);
  session.voiceAssistant?.close();
  // close() aborts the in-flight turn, but its catch/finally (announce, hold release) settle
  // asynchronously. Wait for the hold so that cleanup runs before the actor stops and the
  // process exits, instead of racing a stopped session.
  await session.teardownHold.drain();
  session.entry.userbot.setVoiceAudioListener(null);
  if (session.checkpointTimer !== null) {
    clearInterval(session.checkpointTimer);
    session.checkpointTimer = null;
  }
  // Await the final card edit: a shutdown calls process.exit() right after, which would
  // otherwise cut the REST call off and leave live buttons on a dead session.
  await session.card.finalize();
  // Persist final position BEFORE stopping — getPosition() goes null once the stream stops.
  await saveSnapshot(session);
  onAbortStation?.();
  session.torndown = true;
  session.unsubscribe();
  session.actor.stop();
}

export async function destroyAllSessions(input: {
  readonly sessions: Map<string, Session>;
  readonly numbered: NumberedSessions;
  readonly stationFeeder: StationFeeder;
  readonly voiceRecovery: VoiceRecoveryCoordinator<Session>;
  readonly saveSnapshot: (session: Session) => Promise<void>;
}): Promise<void> {
  input.voiceRecovery.cancelAll();
  await input.numbered.shutdown();
  const activeSessions = [...input.sessions.values()];
  for (const session of activeSessions) {
    await destroySession(session, input.saveSnapshot, () => {
      input.stationFeeder.abort(session);
    });
    if (session.playbackChannel !== undefined) {
      await input.numbered.leases.release(session.entry);
    }
  }
  await input.numbered.leases.drain();
  await input.numbered.persistence.drain();
  input.sessions.clear();
}

export function teardownActiveSession(input: {
  readonly session: Session;
  readonly sessions: Map<string, Session>;
  readonly stationFeeder: StationFeeder;
  readonly numbered: NumberedSessions;
  readonly pool: SessionManagerDeps["pool"];
  readonly stateDir: string;
  readonly voiceRecovery: VoiceRecoveryCoordinator<Session>;
  readonly onMetricsRefresh: () => void;
}): void {
  const { session } = input;
  if (!input.sessions.has(session.key)) return;
  input.sessions.delete(session.key);
  input.stationFeeder.abort(session);
  if (session.playbackChannel !== undefined) {
    void input.numbered.refreshAssistant(
      session.guildId,
      session.voiceChannelId,
    );
  }
  if (session.checkpointTimer !== null) {
    clearInterval(session.checkpointTimer);
    session.checkpointTimer = null;
  }
  const lastError = session.actor.getSnapshot().context.lastError;
  session.torndown = true;
  void session.card.finalize();
  session.unsubscribe();
  session.actor.stop();
  session.entry.userbot.setVoiceCloseListener(null);
  session.entry.userbot.setStallListener(null);
  session.voiceAssistant?.close();
  if (session.playbackChannel === undefined) {
    session.entry.userbot.setVoiceAudioListener(null);
    input.pool.release(session.entry);
  } else {
    void input.numbered.leases.release(session.entry);
  }
  const keepFile = session.preserveStateOnTeardown && lastError !== null;
  if (keepFile) {
    log.info("session ended — resume state preserved for reconnect", {
      guildId: session.guildId,
      channelId: session.voiceChannelId,
      lastError,
    });
  } else if (session.playbackChannel === undefined) {
    void deleteSessionStateAfterFlush(input.stateDir, session);
  } else if (session.instanceId !== undefined) {
    void input.numbered.persistence.remove(
      session.guildId,
      session.voiceChannelId,
      session.playbackChannel,
      session.instanceId,
    );
  }
  input.onMetricsRefresh();
  log.info("session ended", {
    guildId: session.guildId,
    channelId: session.voiceChannelId,
  });
  if (
    keepFile &&
    session.recoveredFromVoiceLoss &&
    !session.resumeConfirmed &&
    !session.voiceRecoveryStarted
  ) {
    input.voiceRecovery.rearmAfterFailedRecovery(session);
  }
}
