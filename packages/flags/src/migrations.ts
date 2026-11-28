import type { Database } from "bun:sqlite";

/**
 * One additive schema step. `up` runs inside an immediate transaction together
 * with the `PRAGMA user_version` bump, so a failing step leaves both the schema
 * and the stored version as they were.
 */
export type Migration = {
  readonly version: number;
  readonly up: (db: Database, now: Date) => void;
};

export const migrations: readonly Migration[] = [
  {
    version: 1,
    up(db, now) {
      // No foreign key to `flag`: retire deletes the flag row and keeps its
      // audit history.
      db.run(`
        CREATE TABLE flag_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL,
          deployment_id TEXT NOT NULL REFERENCES deployment(id),
          key TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('create', 'update', 'retire')),
          actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human', 'machine', 'system')),
          actor_id TEXT NOT NULL,
          revision_after INTEGER NOT NULL,
          before_body TEXT,
          after_body TEXT
        )
      `);
      db.run(
        "CREATE INDEX flag_audit_key ON flag_audit (deployment_id, key, id)",
      );
      db.run(`
        CREATE TABLE store_meta (
          name TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      db.query("INSERT INTO store_meta (name, value) VALUES (?, ?)").run(
        "audit_started_at",
        now.toISOString(),
      );
    },
  },
];

type UserVersionRow = { readonly user_version: number };

export function userVersion(db: Database): number {
  const row = db.query<UserVersionRow, []>("PRAGMA user_version").get();
  if (row === null) throw new Error("PRAGMA user_version returned no row");
  return row.user_version;
}

/**
 * Applies every step newer than the stored `user_version`, oldest first. A
 * database written by a newer image is refused rather than guessed at.
 */
export function migrate(
  db: Database,
  now: Date,
  steps: readonly Migration[] = migrations,
): void {
  for (const [index, step] of steps.entries()) {
    if (step.version !== index + 1) {
      throw new Error(
        `migration ${String(index)} has version ${String(step.version)}, expected ${String(index + 1)}`,
      );
    }
  }
  const current = userVersion(db);
  const newest = steps.length;
  if (current > newest) {
    throw new Error(
      `flags database schema version ${String(current)} is newer than this image supports (${String(newest)})`,
    );
  }
  for (const step of steps) {
    if (step.version <= current) continue;
    db.transaction(() => {
      step.up(db, now);
      // PRAGMA arguments cannot be bound; the version is a checked integer.
      db.run(`PRAGMA user_version = ${String(step.version)}`);
    }).immediate();
  }
}
