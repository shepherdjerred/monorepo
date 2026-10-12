import type { GameDriver } from "@shepherdjerred/discord-stream-lifecycle/lifecycle/game-driver";
import type { PooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/pooled-userbot";
import type { UserbotProvider } from "@shepherdjerred/discord-stream-lifecycle/pool/userbot-pool";
import { ensureSessionDir } from "@shepherdjerred/discord-stream-lifecycle/persistence/session-paths";
import {
  snapshotSaveDir,
  type SaveHistoryOptions,
} from "@shepherdjerred/discord-stream-lifecycle/persistence/save-history";
import type { Session, SessionStopReason } from "./session.ts";

export type SessionManagerLogger = {
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

const noopLogger: SessionManagerLogger = {
  info: () => {
    /* silent default — consumers inject a real logger */
  },
  warn: () => {
    /* silent default */
  },
  error: () => {
    /* silent default */
  },
};

export type StartSessionRequest = {
  readonly guildId: string;
  readonly voiceChannelId: string;
  readonly textChannelId: string;
  readonly startedByUserId: string;
};

export type StartSessionResult<TUserbot extends PooledUserbot> =
  | { readonly kind: "started"; readonly session: Session<TUserbot> }
  /** A session is already running (either this guild or another). */
  | {
      readonly kind: "alreadyActive";
      readonly active: Session<TUserbot>;
    }
  /** No pooled userbot is a member of `guildId` or all member-userbots are busy. */
  | { readonly kind: "noUserbotAvailable" }
  /** The driver's `onSessionStart` threw — already cleaned up, userbot released. */
  | { readonly kind: "driverError"; readonly error: Error };

export type StopSessionResult =
  /** The session was torn down; `error` is set when the driver's teardown threw (e.g. a save flush failed). */
  | { readonly kind: "stopped"; readonly error?: Error }
  /** Nothing to stop: idle, or the active session is not the one the caller expected. */
  | { readonly kind: "notActive" };

export type StopSessionOptions<TUserbot extends PooledUserbot> = {
  /**
   * Only stop if this exact session is still the active one. Callers that decided to
   * stop based on an earlier read (a `/stop` in guild A, an alone-in-voice timer) pass
   * it so a session another guild started in between is never torn down by mistake.
   */
  readonly expected?: Session<TUserbot>;
};

export type SessionManagerOptions<TUserbot extends PooledUserbot> = {
  readonly pool: UserbotProvider<TUserbot>;
  readonly driver: GameDriver<TUserbot>;
  /** Root directory under which `<guildId>/` session dirs are created. */
  readonly stateRootDir: string;
  /**
   * Snapshot these save entries into `<sessionDir>/history/` before every session
   * boots. A snapshot failure aborts the start rather than running unprotected.
   */
  readonly saveHistory?: SaveHistoryOptions;
  readonly logger?: SessionManagerLogger;
  /**
   * Invoked after each session ends (any reason), AFTER the driver's `onSessionStop`
   * and userbot release. Synchronous, must not throw — exceptions are swallowed.
   * Use for cross-cutting cleanup that doesn't belong to the driver, e.g. cancelling
   * the alone-in-voice grace timer so a stale firing can't stop the next session.
   */
  readonly onSessionStopped?: (
    session: Session<TUserbot>,
    reason: SessionStopReason,
  ) => void;
};

/**
 * Single-slot session manager: at most ONE active session per pod at any time. Used
 * by game-bots (pokemon, MK64) where the emulator is a global per-pod resource. A
 * `/play` while a session is active returns `alreadyActive` so the caller can tell the
 * requesting user where the bot currently is.
 *
 * Concurrent-session bots (streambot's per-`(guild,channel)` map) compose their own
 * lifecycle on top of `UserbotPool` directly — this class is for the single-slot case.
 */
export class SingleSlotSessionManager<TUserbot extends PooledUserbot> {
  private readonly pool: UserbotProvider<TUserbot>;
  private readonly driver: GameDriver<TUserbot>;
  private readonly stateRootDir: string;
  private readonly saveHistory: SaveHistoryOptions | undefined;
  private readonly log: SessionManagerLogger;
  private readonly onSessionStopped:
    | ((session: Session<TUserbot>, reason: SessionStopReason) => void)
    | undefined;
  private active: Session<TUserbot> | null = null;
  /** Set while a start/stop is mid-flight so concurrent calls don't race. */
  private inFlight: Promise<unknown> | null = null;

  constructor(options: SessionManagerOptions<TUserbot>) {
    this.pool = options.pool;
    this.driver = options.driver;
    this.stateRootDir = options.stateRootDir;
    this.saveHistory = options.saveHistory;
    this.log = options.logger ?? noopLogger;
    this.onSessionStopped = options.onSessionStopped;
  }

  /** Current session, or null if idle. */
  getActiveSession(): Session<TUserbot> | null {
    return this.active;
  }

  /** Active session iff it's for `guildId`, otherwise null. */
  getActiveSessionForGuild(guildId: string): Session<TUserbot> | null {
    return this.active?.guildId === guildId ? this.active : null;
  }

  /** Build the driver's welcome message for a freshly-started session. */
  buildWelcomeMessage(session: Session<TUserbot>): string {
    return this.driver.welcomeMessage === undefined
      ? `Starting ${this.driver.name} in voice channel <#${session.voiceChannelId}>…`
      : this.driver.welcomeMessage(session);
  }

  /** The driver's human-readable name. */
  driverName(): string {
    return this.driver.name;
  }

  /**
   * Start a session for the requesting guild + voice channel + text channel. Returns:
   * - `{kind: "started"}` on success
   * - `{kind: "alreadyActive"}` if another session is running (any guild)
   * - `{kind: "noUserbotAvailable"}` if the pool has no member-userbot free for this guild
   * - `{kind: "driverError"}` if the driver's `onSessionStart` threw (already cleaned up)
   */
  async start(
    request: StartSessionRequest,
  ): Promise<StartSessionResult<TUserbot>> {
    return this.runExclusive(async () => {
      if (this.active !== null) {
        return { kind: "alreadyActive", active: this.active } as const;
      }
      const entry = this.pool.acquire(request.guildId);
      if (entry === null) {
        return { kind: "noUserbotAvailable" } as const;
      }
      let sessionDirPath: string;
      try {
        sessionDirPath = await ensureSessionDir(
          this.stateRootDir,
          request.guildId,
        );
        if (this.saveHistory !== undefined) {
          const snapshot = await snapshotSaveDir(
            sessionDirPath,
            this.saveHistory,
          );
          if (snapshot !== null) {
            this.log.info("save history snapshot taken", {
              guildId: request.guildId,
              snapshot,
            });
          }
        }
      } catch (error) {
        this.pool.release(entry);
        const err = toError(error);
        this.log.error("failed to prepare session directory", {
          guildId: request.guildId,
          error: err.message,
        });
        return { kind: "driverError", error: err } as const;
      }
      const session: Session<TUserbot> = {
        guildId: request.guildId,
        voiceChannelId: request.voiceChannelId,
        textChannelId: request.textChannelId,
        startedByUserId: request.startedByUserId,
        startedAt: new Date(),
        userbotEntry: entry,
        sessionDir: sessionDirPath,
      };
      try {
        await this.driver.onSessionStart(session);
      } catch (error) {
        const err = toError(error);
        this.log.error("driver onSessionStart threw; releasing userbot", {
          guildId: request.guildId,
          driver: this.driver.name,
          error: err.message,
        });
        // Best-effort cleanup; never throw out of cleanup.
        await this.safeDriverStop(session, "error");
        this.pool.release(entry);
        return { kind: "driverError", error: err } as const;
      }
      this.active = session;
      this.log.info("session started", {
        driver: this.driver.name,
        guildId: session.guildId,
        voiceChannelId: session.voiceChannelId,
        textChannelId: session.textChannelId,
      });
      return { kind: "started", session } as const;
    });
  }

  /**
   * Stop the active session (if any). Idempotent: calling stop when idle is a no-op.
   * Always releases the userbot back to the pool, even if the driver throws on stop;
   * the driver's error is returned so callers never report a save as flushed when it
   * was not.
   */
  async stop(
    reason: SessionStopReason,
    options: StopSessionOptions<TUserbot> = {},
  ): Promise<StopSessionResult> {
    return this.runExclusive(async (): Promise<StopSessionResult> => {
      const session = this.active;
      if (session === null) {
        return { kind: "notActive" };
      }
      if (options.expected !== undefined && options.expected !== session) {
        this.log.warn("stop skipped: active session changed", {
          driver: this.driver.name,
          expectedGuildId: options.expected.guildId,
          activeGuildId: session.guildId,
          reason,
        });
        return { kind: "notActive" };
      }
      this.active = null;
      const error = await this.safeDriverStop(session, reason);
      this.pool.release(session.userbotEntry);
      this.log.info("session stopped", {
        driver: this.driver.name,
        guildId: session.guildId,
        reason,
      });
      if (this.onSessionStopped !== undefined) {
        try {
          this.onSessionStopped(session, reason);
        } catch (hookError) {
          this.log.error("onSessionStopped hook threw; ignoring", {
            guildId: session.guildId,
            reason,
            error: toError(hookError).message,
          });
        }
      }
      return error === undefined
        ? { kind: "stopped" }
        : { kind: "stopped", error };
    });
  }

  private async safeDriverStop(
    session: Session<TUserbot>,
    reason: SessionStopReason,
  ): Promise<Error | undefined> {
    try {
      await this.driver.onSessionStop(session, reason);
      return undefined;
    } catch (error) {
      const err = toError(error);
      this.log.error("driver onSessionStop threw; releasing userbot anyway", {
        guildId: session.guildId,
        driver: this.driver.name,
        reason,
        error: err.message,
      });
      return err;
    }
  }

  /** Serializes start/stop so a `/stop` racing with a `/play` produces a well-defined order. */
  private async runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.inFlight ?? Promise.resolve();
    const next = (async (): Promise<T> => {
      try {
        await previous;
      } catch {
        // Earlier work's failure must not block this call.
      }
      return work();
    })();
    this.inFlight = (async (): Promise<void> => {
      try {
        await next;
      } catch {
        // Swallow — callers observe outcomes via `next`.
      }
    })();
    return next;
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
