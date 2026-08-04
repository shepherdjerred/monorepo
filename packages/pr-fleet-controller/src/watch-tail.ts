import { readdir } from "node:fs/promises";
import path from "node:path";

const NEWLINE = 0x0a;

/**
 * Split a growing append-only byte stream into complete UTF-8 lines, carrying
 * any trailing partial line forward as `remainder`. Splitting on the newline
 * byte (never part of a multi-byte UTF-8 sequence) means a chunk boundary that
 * lands mid-character is preserved intact in `remainder` for the next chunk.
 */
export function splitAppendedLines(
  leftover: Buffer,
  chunk: Buffer,
): { lines: string[]; remainder: Buffer } {
  const combined =
    leftover.length === 0 ? chunk : Buffer.concat([leftover, chunk]);
  const lastNewline = combined.lastIndexOf(NEWLINE);
  if (lastNewline === -1) {
    return { lines: [], remainder: combined };
  }
  const complete = combined.subarray(0, lastNewline).toString("utf8");
  const remainder = Buffer.from(combined.subarray(lastNewline + 1));
  const lines = complete.split("\n").filter((line) => line.length > 0);
  return { lines, remainder };
}

/**
 * A run id is `<ISO-timestamp-with-colons-as-dashes>-<uuid>`; the ISO prefix
 * makes lexicographic order match chronological order, so the newest run is the
 * lexicographically greatest directory name. Pure so it is testable without a
 * filesystem.
 */
export function selectLatestRunId(runIds: readonly string[]): string | null {
  let latest: string | null = null;
  for (const runId of runIds) {
    if (latest === null || runId > latest) {
      latest = runId;
    }
  }
  return latest;
}

/**
 * Resolve the newest run directory under the state root — the run a bare
 * `pr:fleet:watch` (or the controller's auto-spawn) attaches to. Returns null
 * when the root has no run directories yet.
 */
export async function resolveLatestRunDirectory(
  stateRoot: string,
): Promise<string | null> {
  let entries: string[];
  try {
    const dirents = await readdir(stateRoot, { withFileTypes: true });
    entries = dirents
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const latest = selectLatestRunId(entries);
  return latest === null ? null : path.join(stateRoot, latest);
}
