import { mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Single source of truth for the per-guild persistence layout: every game-bot writes
 * under `<rootDir>/<guildId>/`. `guildId` is a Discord snowflake (digits-only) so it
 * never contains path separators or `..`; we still validate to be safe.
 */
export function sessionDir(rootDir: string, guildId: string): string {
  if (!/^\d+$/.test(guildId)) {
    throw new Error(
      `invalid guildId for session dir: ${JSON.stringify(guildId)}`,
    );
  }
  return path.join(rootDir, guildId);
}

/** Ensure `sessionDir(rootDir, guildId)` exists; returns the path. */
export async function ensureSessionDir(
  rootDir: string,
  guildId: string,
): Promise<string> {
  const dir = sessionDir(rootDir, guildId);
  await mkdir(dir, { recursive: true });
  return dir;
}
