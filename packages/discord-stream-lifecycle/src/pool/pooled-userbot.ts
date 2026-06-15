/**
 * The minimum surface the userbot pool depends on: log in to Discord, expose identity
 * and guild membership, and tear down. Game-specific voice + streaming concerns
 * (joinVoice, runStream, getPosition, ...) belong on the game's own client wrapper —
 * the pool does NOT know about them.
 */
export type PooledUserbot = {
  /** Connect to the gateway. Resolves once `READY` has fired and `guildIds()` is stable. */
  login: () => Promise<void>;
  /** Discord user id of the underlying account (used by auto-leave to exclude self). */
  userId: () => string;
  /** Guilds this userbot is a member of (snapshot taken at login). */
  guildIds: () => readonly string[];
  /** Log out + drop sockets. Idempotent. */
  destroy: () => Promise<void>;
};

/** Factory injected into the pool: build a userbot from a token. Tests pass fakes. */
export type PooledUserbotFactory<TUserbot extends PooledUserbot> = (
  token: string,
) => TUserbot;
