import type { GameDriver } from "@shepherdjerred/discord-stream-lifecycle/lifecycle/game-driver.ts";
import type { PooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/pooled-userbot.ts";
import type { UserbotProvider } from "@shepherdjerred/discord-stream-lifecycle/pool/userbot-pool.ts";
import { ensureSessionDir } from "@shepherdjerred/discord-stream-lifecycle/persistence/session-paths.ts";
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

export type SessionManagerOptions<TUserbot extends PooledUserbot> = {
  readonly pool: UserbotProvider<TUserbot>;
  readonly driver: GameDriver<TUserbot>;
  /** Root directory under which `<guildId>/` session dirs are created. */
  readonly stateRootDir: string;
  readonly logger?: SessionManagerLogger;
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
  private readonly log: SessionManagerLogger;
  private active: Session<TUserbot> | null = null;
  /** Set while a start/stop is mid-flight so concurrent calls don't race. */
  private inFlight: Promise<unknown> | null = null;

  constructor(options: SessionManagerOptions<TUserbot>) {
    this.pool = options.pool;
    this.driver = options.driver;
    this.stateRootDir = options.stateRootDir;
    this.log = options.logger ?? noopLogger;
  }

  /** Current session, or null if idle. */
  getActiveSession(): Session<TUserbot> | null {
    return this.active;
  }

  /** Active session iff it's for `guildId`, otherwise null. */
  getActiveSessionForGuild(guildId: string): Session<TUserbot> | null {
    if (this.active?.guildId !== guildId) {
      return null;
    }
    return this.active;
  }

  /** Build the driver's welcome message for a freshly-started session. */
  buildWelcomeMessage(session: Session<TUserbot>): string {
    if (this.driver.welcomeMessage !== undefined) {
      return this.driver.welcomeMessage(session);
    }
    return `Starting ${this.driver.name} in voice channel <#${session.voiceChannelId}>…`;
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
      } catch (error) {
        this.pool.release(entry);
        const err = toError(error);
        this.log.error("failed to create session directory", {
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
   * Always releases the userbot back to the pool, even if the driver throws on stop.
   */
  async stop(reason: SessionStopReason): Promise<void> {
    await this.runExclusive(async () => {
      const session = this.active;
      if (session === null) {
        return;
      }
      this.active = null;
      await this.safeDriverStop(session, reason);
      this.pool.release(session.userbotEntry);
      this.log.info("session stopped", {
        driver: this.driver.name,
        guildId: session.guildId,
        reason,
      });
    });
  }

  private async safeDriverStop(
    session: Session<TUserbot>,
    reason: SessionStopReason,
  ): Promise<void> {
    try {
      await this.driver.onSessionStop(session, reason);
    } catch (error) {
      this.log.error("driver onSessionStop threw; releasing userbot anyway", {
        guildId: session.guildId,
        driver: this.driver.name,
        reason,
        error: toError(error).message,
      });
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
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
}
