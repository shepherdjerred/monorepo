import { UserbotPool as SharedUserbotPool } from "@shepherdjerred/discord-stream-lifecycle/pool/userbot-pool.ts";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { StreambotStreamer } from "@shepherdjerred/streambot/streamer/streamer.ts";
import type { StreamerLike } from "@shepherdjerred/streambot/streamer/streamer.ts";
import {
  UserTokenSchema,
  type UserToken,
} from "@shepherdjerred/streambot/types/ids.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("userbot-pool");

/** A single pooled userbot: its streamer (in `.userbot`), guilds it serves, busy flag. */
export type UserbotEntry = {
  readonly userbot: StreamerLike;
  readonly guildIds: ReadonlySet<string>;
  busy: boolean;
};

/** The pool surface the session manager depends on — lets tests supply a fake. */
export type UserbotProvider = {
  acquire: (guildId: string) => UserbotEntry | null;
  release: (entry: UserbotEntry) => void;
  canServe: (guildId: string) => boolean;
};

/** Factory for pooled streamers — injectable so tests can supply fakes without a live gateway. */
export type StreamerFactory = (
  token: UserToken,
  config: Pick<Config, "stream">,
) => StreamerLike;

/**
 * Pool of selfbot userbots shared across all servers. Each userbot is a distinct Discord account
 * that can only stream into guilds it is a member of, and into one voice channel at a time. A
 * session {@link acquire}s a free member-userbot and {@link release}s it when it ends; when none
 * is free the caller tells the requester no bots are available.
 *
 * Thin wrapper over `@shepherdjerred/discord-stream-lifecycle`'s generic pool — keeps the
 * streambot-flavored factory signature and logger plumbing while the lib owns acquire/release.
 */
export class UserbotPool implements UserbotProvider {
  private readonly inner: SharedUserbotPool<StreamerLike>;

  constructor(
    tokens: readonly UserToken[],
    config: Pick<Config, "stream">,
    createStreamer: StreamerFactory = (token, cfg) =>
      new StreambotStreamer(token, cfg),
  ) {
    this.inner = new SharedUserbotPool<StreamerLike>({
      tokens,
      factory: (token) => createStreamer(UserTokenSchema.parse(token), config),
      logger: {
        info: (message, metadata) => {
          log.info(message, metadata);
        },
        warn: (message, metadata) => {
          log.warn(message, metadata);
        },
      },
    });
  }

  async start(): Promise<void> {
    await this.inner.start();
  }

  acquire(guildId: string): UserbotEntry | null {
    return this.inner.acquire(guildId);
  }

  release(entry: UserbotEntry): void {
    this.inner.release(entry);
  }

  canServe(guildId: string): boolean {
    return this.inner.canServe(guildId);
  }

  serveableGuildIds(): Set<string> {
    return this.inner.serveableGuildIds();
  }

  async destroy(): Promise<void> {
    await this.inner.destroy();
  }
}
