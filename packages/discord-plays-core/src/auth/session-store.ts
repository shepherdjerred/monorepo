// Signed-in browsers. The cookie carries a random token; stores keep only its
// SHA-256, so a leaked store cannot be replayed as a cookie.
import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { DiscordUserSchema, type DiscordUser } from "./protocol.ts";

export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function nonce(): string {
  return randomBytes(32).toString("base64url");
}

export type WebSessionStore = {
  /** Start a session for a user; returns the cookie token. */
  create: (user: DiscordUser, nowMs?: number) => Promise<string>;
  /** The signed-in user for a cookie token, or undefined if unknown or expired. */
  read: (token: string, nowMs?: number) => Promise<DiscordUser | undefined>;
  delete: (token: string) => Promise<void>;
};

/**
 * Sessions in a SQLite file of their own, for a game with no database of its
 * own. The user's profile is stored with the session as signed in; it is
 * refreshed at the next sign-in.
 */
export function createSqliteSessionStore(path: string): WebSessionStore & {
  /** Synchronous admission check for each live-feed access unit. */
  readSync: (token: string, nowMs?: number) => DiscordUser | undefined;
} {
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`CREATE TABLE IF NOT EXISTS web_sessions (
    token_hash TEXT PRIMARY KEY,
    user_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`);
  const removeExpired = db.query(
    "DELETE FROM web_sessions WHERE expires_at <= $now",
  );
  const insert = db.query(
    "INSERT INTO web_sessions (token_hash, user_json, expires_at) VALUES ($hash, $user, $expires)",
  );
  const select = db.query<
    { user_json: string; expires_at: number },
    { hash: string }
  >("SELECT user_json, expires_at FROM web_sessions WHERE token_hash = $hash");
  const remove = db.query("DELETE FROM web_sessions WHERE token_hash = $hash");

  function readSync(
    token: string,
    nowMs = Date.now(),
  ): DiscordUser | undefined {
    const row = select.get({ hash: digest(token) });
    const live = row !== null && row.expires_at > nowMs;
    return live
      ? DiscordUserSchema.parse(JSON.parse(row.user_json))
      : undefined;
  }

  return {
    create(user, nowMs = Date.now()) {
      const token = nonce();
      removeExpired.run({ now: nowMs });
      insert.run({
        hash: digest(token),
        user: JSON.stringify(user),
        expires: nowMs + SESSION_LIFETIME_SECONDS * 1000,
      });
      return Promise.resolve(token);
    },
    read(token, nowMs = Date.now()) {
      return Promise.resolve(readSync(token, nowMs));
    },
    readSync,
    delete(token) {
      remove.run({ hash: digest(token) });
      return Promise.resolve();
    },
  };
}
