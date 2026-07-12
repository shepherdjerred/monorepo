import type { PooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/pooled-userbot";
import type {
  Session,
  SessionStopReason,
} from "@shepherdjerred/discord-stream-lifecycle/session/session";

/**
 * The plug-in interface every game-bot implements. The SessionManager wires `/play` and
 * `/stop` to this driver: on `/play` the manager acquires a userbot, ensures
 * `sessionDir`, and calls `onSessionStart`; on `/stop` (or auto-leave / idle / shutdown)
 * it calls `onSessionStop` and releases the userbot.
 *
 * Drivers should be idempotent at the boundaries: a second `onSessionStop` for the
 * same guild is a no-op, and `onSessionStart` must not assume any prior process state.
 */
export type GameDriver<TUserbot extends PooledUserbot> = {
  /** Human-readable game name (used in log lines and `/play` reply). */
  readonly name: string;

  /**
   * Boot the game for this session. Implementations: instantiate the emulator with
   * `session.sessionDir`, attach the streamer to `session.userbotEntry.userbot`, wire
   * notifications to `session.textChannelId`. Must throw if start fails — the
   * SessionManager will release the userbot and report the error.
   */
  onSessionStart: (session: Session<TUserbot>) => Promise<void>;

  /**
   * Tear the game down: flush saves, stop emulator, detach streamer. The manager has
   * already decided the session is over; this hook only runs cleanup. Errors here are
   * logged but never block the userbot from being released back to the pool.
   */
  onSessionStop: (
    session: Session<TUserbot>,
    reason: SessionStopReason,
  ) => Promise<void>;

  /**
   * Optional: per-driver custom welcome message body for the `/play` reply. Defaults to
   * a generic "Started <name> in <#voice>" if omitted.
   */
  welcomeMessage?: (session: Session<TUserbot>) => string;
};
