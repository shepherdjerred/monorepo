/**
 * A throwaway SQLite database for tests that exercise the real dialect shim.
 *
 * These tests run against bun:sqlite rather than a fake, because the migration's
 * sharpest bugs have been dialect behaviour — numbered placeholders binding by
 * position, an unresolvable quoted name becoming a string literal, upsert
 * semantics — none of which a stub would reproduce.
 *
 * Shared because every such test needs the same three things: the environment
 * in place before `support.ts` is imported, a file that exists before `openDb`
 * refuses to create one, and cleanup of the WAL sidecars.
 */

/** Remove a database and the sidecars WAL mode leaves beside it. */
export async function removeDatabase(path: string): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      await Bun.file(`${path}${suffix}`).delete();
    } catch {
      // Absent is the desired state.
    }
  }
}

/**
 * Open a fresh database at `path`.
 *
 * The file is created first because the migration deliberately refuses to
 * create its own target — a mistyped path has to fail loudly rather than read
 * as an empty database with no work to do.
 */
export async function openFixtureDatabase(path: string) {
  const { Database } = await import("bun:sqlite");
  new Database(path, { create: true }).close();
  const { openDb } = await import("./db.ts");
  return openDb();
}
