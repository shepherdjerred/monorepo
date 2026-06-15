import type { PooledUserbot, PooledUserbotFactory } from "./pooled-userbot.ts";

/** A single pooled userbot: its client, the guilds it can serve, whether it's in use. */
export type UserbotEntry<TUserbot extends PooledUserbot> = {
  readonly userbot: TUserbot;
  /** Guilds this userbot is a member of (snapshot at login). */
  readonly guildIds: ReadonlySet<string>;
  /** True while a session is currently using this userbot. */
  busy: boolean;
};

/** The pool surface session managers depend on — lets tests supply a fake. */
export type UserbotProvider<TUserbot extends PooledUserbot> = {
  acquire: (guildId: string) => UserbotEntry<TUserbot> | null;
  release: (entry: UserbotEntry<TUserbot>) => void;
  /** True if any userbot is a member of `guildId` regardless of busy state. */
  canServe: (guildId: string) => boolean;
};

export type UserbotPoolLogger = {
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
};

const noopLogger: UserbotPoolLogger = {
  info: () => {
    /* no-op */
  },
  warn: () => {
    /* no-op */
  },
};

/**
 * Pool of selfbot userbots shared across all servers. Each userbot is a distinct Discord
 * account that can only stream into guilds it is a member of, and only one voice channel
 * at a time. A session {@link acquire}s a free member-userbot and {@link release}s it when
 * it ends; if none is free the caller tells the requester no bots are available.
 *
 * Membership is discovered at login from the gateway, so "the servers a userbot serves"
 * is exactly "the servers the account is in" — no extra config.
 */
export class UserbotPool<TUserbot extends PooledUserbot> {
  private readonly entries: UserbotEntry<TUserbot>[] = [];
  private readonly tokens: readonly string[];
  private readonly factory: PooledUserbotFactory<TUserbot>;
  private readonly log: UserbotPoolLogger;

  constructor(params: {
    tokens: readonly string[];
    factory: PooledUserbotFactory<TUserbot>;
    logger?: UserbotPoolLogger;
  }) {
    this.tokens = params.tokens;
    this.factory = params.factory;
    this.log = params.logger ?? noopLogger;
  }

  /**
   * Log every userbot in (in parallel) and snapshot guild membership. Tokens that fail
   * are skipped with a warning; only an all-fail outcome throws (the bot can't serve anyone).
   */
  async start(): Promise<void> {
    const results = await Promise.allSettled(
      this.tokens.map(async (token) => {
        const userbot = this.factory(token);
        await userbot.login();
        const entry: UserbotEntry<TUserbot> = {
          userbot,
          guildIds: new Set(userbot.guildIds()),
          busy: false,
        };
        return entry;
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        this.entries.push(result.value);
      } else {
        this.log.warn("userbot failed to log in; skipping", {
          error: errorMessage(result.reason),
        });
      }
    }

    if (this.entries.length === 0) {
      const firstFailure = results.find((r) => r.status === "rejected");
      const cause =
        firstFailure?.status === "rejected"
          ? errorMessage(firstFailure.reason)
          : "no tokens configured";
      throw new Error(`no userbots could log in: ${cause}`);
    }

    this.log.info("userbot pool ready", {
      size: this.entries.length,
      guilds: this.serveableGuildIds().size,
    });
  }

  /** Acquire a free userbot that is a member of `guildId`, or null if none available. */
  acquire(guildId: string): UserbotEntry<TUserbot> | null {
    const entry = this.entries.find(
      (candidate) => !candidate.busy && candidate.guildIds.has(guildId),
    );
    if (entry === undefined) {
      return null;
    }
    entry.busy = true;
    return entry;
  }

  /** Return a userbot to the pool (its caller has already left voice). */
  release(entry: UserbotEntry<TUserbot>): void {
    entry.busy = false;
  }

  /** True if any pooled userbot is a member of `guildId` (ignores busy state). */
  canServe(guildId: string): boolean {
    return this.entries.some((entry) => entry.guildIds.has(guildId));
  }

  /** Union of all guilds the pool can serve — used for command registration / diagnostics. */
  serveableGuildIds(): Set<string> {
    const all = new Set<string>();
    for (const entry of this.entries) {
      for (const guildId of entry.guildIds) {
        all.add(guildId);
      }
    }
    return all;
  }

  /** Number of currently-busy userbots in the pool. */
  busyCount(): number {
    return this.entries.filter((entry) => entry.busy).length;
  }

  /** Total number of userbots in the pool (including busy ones). */
  size(): number {
    return this.entries.length;
  }

  /** Log every userbot out. Idempotent — safe to call on shutdown. */
  async destroy(): Promise<void> {
    await Promise.all(this.entries.map((entry) => entry.userbot.destroy()));
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
