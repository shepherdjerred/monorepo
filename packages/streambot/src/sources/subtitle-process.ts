import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { runSubprocess } from "@shepherdjerred/streambot/sources/subprocess.ts";

/**
 * Shared low-level plumbing for subtitle staging: the swept temp directory under
 * `os.tmpdir()/streambot-subs/` and a best-effort subprocess runner for ffprobe/ffmpeg/yt-dlp.
 */

export const subtitleLog = logger.child("subtitles");

function subsTempDir(): string {
  return path.join(os.tmpdir(), "streambot-subs");
}

export async function ensureTempDir(): Promise<string> {
  const dir = subsTempDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export function tempFile(dir: string, ext: string): string {
  return path.join(dir, `${randomUUID()}.${ext}`);
}

/** Remove all staged subtitle temp files. Call once at startup to clear orphans from a previous run. */
export async function sweepSubtitleTempDir(): Promise<void> {
  try {
    await rm(subsTempDir(), { recursive: true, force: true });
  } catch (error) {
    subtitleLog.warn("failed to sweep subtitle temp dir", {
      error: getErrorMessage(error),
    });
  }
}

export type ProcResult = { ok: boolean; stdout: string; stderr: string };

export async function runSubtitleProcess(
  cmd: string[],
  signal: AbortSignal,
): Promise<ProcResult> {
  // Subtitles are best-effort: a missing binary (ENOENT from Bun.spawn), an abort, or any spawn
  // failure must degrade to "no subtitle", never throw through resolution and abort playback.
  try {
    const { stdout, stderr, exitCode } = await runSubprocess(cmd, signal);
    return { ok: exitCode === 0, stdout, stderr };
  } catch (error) {
    subtitleLog.warn("subtitle subprocess failed to run", {
      command: cmd[0],
      error: getErrorMessage(error),
    });
    return { ok: false, stdout: "", stderr: getErrorMessage(error) };
  }
}
