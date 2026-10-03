import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  IdentitySchema,
  type WebIdentity,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";

const SessionRowSchema = z.strictObject({
  identity: z.string(),
  csrf_hash: z.string(),
});
const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
export const sessionLifetimeSeconds = SESSION_LIFETIME_SECONDS;
export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function nonce(): string {
  return randomBytes(32).toString("base64url");
}
export type WebSession = {
  key: string;
  identity: WebIdentity;
  csrfHash: string;
};

export class WebSessionStore {
  private readonly database: Database;

  constructor(filePath: string) {
    this.database = new Database(filePath, { create: true, strict: true });
    this.database.run("PRAGMA journal_mode = WAL");
    this.database.run(
      "CREATE TABLE IF NOT EXISTS web_sessions (token_hash TEXT PRIMARY KEY, identity TEXT NOT NULL, csrf_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)",
    );
  }

  create(
    identity: WebIdentity,
    now = Date.now(),
  ): { token: string; csrfToken: string } {
    const token = nonce();
    const csrfToken = nonce();
    this.database
      .query("DELETE FROM web_sessions WHERE expires_at <= ?1")
      .run(now);
    this.database
      .query("INSERT INTO web_sessions VALUES (?1, ?2, ?3, ?4)")
      .run(
        digest(token),
        JSON.stringify(identity),
        digest(csrfToken),
        now + SESSION_LIFETIME_SECONDS * 1000,
      );
    return { token, csrfToken };
  }

  read(token: string, now = Date.now()): WebSession | null {
    const key = digest(token);
    const raw = this.database
      .query(
        "SELECT identity, csrf_hash FROM web_sessions WHERE token_hash = ?1 AND expires_at > ?2",
      )
      .get(key, now);
    if (raw === null) return null;
    const row = SessionRowSchema.parse(raw);
    const identity: unknown = JSON.parse(row.identity);
    return {
      key,
      identity: IdentitySchema.parse(identity),
      csrfHash: row.csrf_hash,
    };
  }

  delete(token: string): void {
    this.database
      .query("DELETE FROM web_sessions WHERE token_hash = ?1")
      .run(digest(token));
  }
  close(): void {
    this.database.close();
  }
}
