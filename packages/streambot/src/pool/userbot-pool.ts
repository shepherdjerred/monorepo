import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  StreambotStreamer,
  type StreamerLike,
} from "@shepherdjerred/streambot/streamer/streamer.ts";
import type {
  GuildId,
  UserToken,
} from "@shepherdjerred/streambot/types/ids.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("userbot-pool");

/** A single pooled userbot: its streamer, the guilds it can serve, and whether it's in use. */
export type UserbotEntry = {
  readonly streamer: StreamerLike;
  /** Guilds this userbot is a member of (snapshot taken at login). */
  readonly guildIds: Set<GuildId>;
  /** True while a session is streaming through this userbot. */
  busy: boolean;
};

/** The pool surface the session manager depends on — lets tests supply a fake. */
export type UserbotProvider = {
  acquire: (guildId: GuildId) => UserbotEntry | null;
  release: (entry: UserbotEntry) => void;
  /** Whether any pooled userbot is a member of `guildId` (regardless of busy state). */
  canServe: (guildId: GuildId) => boolean;
};

/** A streamer the pool can log in and probe membership on (production: {@link StreambotStreamer}). */
export type PooledStreamer = StreamerLike & {
  login: () => Promise<void>;
  guildIds: () => GuildId[];
};

/** Factory for pooled streamers — injectable so tests can supply fakes without a live gateway. */
export type StreamerFactory = (
  token: UserToken,
  config: Pick<Config, "stream">,
) => PooledStreamer;

/**
 * Pool of selfbot userbots shared across all servers. Each userbot is a distinct Discord account that
 * can only stream into guilds it is a member of, and into one voice channel at a time. A session
 * {@link acquire}s a free member-userbot and {@link release}s it when it ends; when none is free the
 * caller tells the requester no bots are available.
 *
 * Membership is discovered at login from the gateway (`client.guilds.cache`), so "the servers a
 * userbot serves" is exactly "the servers the account is in" — no extra config.
 */
export class UserbotPool {
  private readonly entries: UserbotEntry[] = [];
  private readonly tokens: readonly UserToken[];
  private readonly config: Pick<Config, "stream">;
  private readonly createStreamer: StreamerFactory;

  constructor(
    tokens: readonly UserToken[],
    config: Pick<Config, "stream">,
    createStreamer: StreamerFactory = (token, cfg) =>
      new StreambotStreamer(token, cfg),
  ) {
    this.tokens = tokens;
    this.config = config;
    this.createStreamer = createStreamer;
  }

  /**
   * Log every userbot in (in parallel) and snapshot its guild membership. A token that fails to log
   * in is skipped with a warning; only an all-fail outcome throws (the bot can't serve anyone).
   */
  async start(): Promise<void> {
    const results = await Promise.allSettled(
      this.tokens.map(async (token) => {
        const streamer = this.createStreamer(token, this.config);
        await streamer.login();
        const entry: UserbotEntry = {
          streamer,
          guildIds: new Set(streamer.guildIds()),
          busy: false,
        };
        return entry;
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        this.entries.push(result.value);
      } else {
        log.warn("userbot failed to log in; skipping", {
          error: getErrorMessage(result.reason),
        });
      }
    }

    if (this.entries.length === 0) {
      // Surface the first underlying failure so smoke tests still see the auth error.
      const firstFailure = results.find((r) => r.status === "rejected");
      const cause =
        firstFailure?.status === "rejected"
          ? getErrorMessage(firstFailure.reason)
          : "no tokens configured";
      throw new Error(`no userbots could log in: ${cause}`);
    }

    log.info("userbot pool ready", {
      size: this.entries.length,
      guilds: [...this.serveableGuildIds()].length,
    });
  }

  /** Acquire a free userbot that is a member of `guildId`, or null if none is available. */
  acquire(guildId: GuildId): UserbotEntry | null {
    const entry = this.entries.find(
      (candidate) => !candidate.busy && candidate.guildIds.has(guildId),
    );
    if (entry === undefined) {
      return null;
    }
    entry.busy = true;
    return entry;
  }

  /** Return a userbot to the pool (its streamer has already left voice). */
  release(entry: UserbotEntry): void {
    entry.busy = false;
  }

  /** Whether any pooled userbot is a member of `guildId` (ignores busy state). */
  canServe(guildId: GuildId): boolean {
    return this.entries.some((entry) => entry.guildIds.has(guildId));
  }

  /** Union of all guilds the pool can serve — used to size command registration / diagnostics. */
  serveableGuildIds(): Set<GuildId> {
    const all = new Set<GuildId>();
    for (const entry of this.entries) {
      for (const guildId of entry.guildIds) {
        all.add(guildId);
      }
    }
    return all;
  }

  /** Log out every userbot. */
  async destroy(): Promise<void> {
    await Promise.all(this.entries.map((entry) => entry.streamer.destroy()));
  }
}
