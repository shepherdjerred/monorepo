import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { SourceSchema } from "@shepherdjerred/streambot/sources/source.ts";
import { LoopModeSchema } from "@shepherdjerred/streambot/machine/types.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
  type ChannelId,
  type GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("persistence");

/** A persisted queue entry — the requested source plus who asked for it. */
export const PersistedQueuedSchema = z.strictObject({
  source: SourceSchema,
  requesterId: UserIdSchema,
});
export type PersistedQueued = z.infer<typeof PersistedQueuedSchema>;

/** The in-progress item, with the resume offset and an optional resolved title for the announce. */
export const PersistedCurrentSchema = z.strictObject({
  source: SourceSchema,
  requesterId: UserIdSchema,
  /** Resolved human title (if known), so the back-online message can name the video immediately. */
  title: z.string().min(1).optional(),
  /** Where playback had reached (seconds) — the resume seek offset. */
  positionSeconds: z.number().int().nonnegative(),
});
export type PersistedCurrent = z.infer<typeof PersistedCurrentSchema>;

/**
 * On-disk resume state (schema v2). Deliberately stores the original {@link SourceSchema} (re-resolved
 * on boot) rather than the resolved ffmpeg input, because yt-dlp direct URLs are signed and expire.
 * `guildId`/`channelId` identify the session (one file per voice channel) and are validated against
 * the file name / acquired userbot on boot. `statusChannelId` is where the "I'm back" announcement
 * goes. `resumeAttempts`/`resumeKey` drive the crash-loop guard in `resume.ts`.
 *
 * v1 files (no `statusChannelId`, `version: 1`) fail to parse and are ignored — at most one missed
 * resume across the cutover deploy.
 */
export const PersistedStateSchema = z.strictObject({
  version: z.literal(2),
  savedAt: z.number().int().nonnegative(),
  guildId: GuildIdSchema,
  channelId: ChannelIdSchema,
  /** Text channel to post the back-online announcement to; null when unknown (e.g. legacy resume). */
  statusChannelId: ChannelIdSchema.nullable().default(null),
  loop: LoopModeSchema,
  volume: z.number(),
  current: PersistedCurrentSchema.nullable(),
  queue: z.array(PersistedQueuedSchema),
  /** How many consecutive boots have tried to resume the current `resumeKey` without confirming it. */
  resumeAttempts: z.number().int().nonnegative().default(0),
  /** Stable key (hash of source + position) of `current`, to detect a resume that keeps crashing. */
  resumeKey: z.string().nullable().default(null),
});
export type PersistedState = z.infer<typeof PersistedStateSchema>;

const STATE_FILE_RE = /^playback-state-(\d{17,20})-(\d{17,20})\.json$/u;

/** Absolute path of a session's resume-state file (one per guild + voice channel). */
export function stateFilePath(
  dir: string,
  guildId: GuildId,
  channelId: ChannelId,
): string {
  return path.join(dir, `playback-state-${guildId}-${channelId}.json`);
}

/**
 * Enumerate the `(guildId, channelId)` pairs that have a resume-state file in `dir`. Fail-soft:
 * returns `[]` when the directory is missing or unreadable (nothing to resume), and skips any file
 * whose name doesn't match the session pattern or whose ids aren't valid snowflakes.
 */
export async function listPersistedStateFiles(
  dir: string,
): Promise<{ guildId: GuildId; channelId: ChannelId }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    // A missing dir is the normal "nothing persisted yet" case. Anything else (permissions, I/O) is
    // logged — resume stays best-effort (we return []), but the failure isn't silently swallowed.
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      log.warn("could not list resume-state dir; skipping resume", {
        dir,
        error: getErrorMessage(error),
      });
    }
    return [];
  }
  const sessions: { guildId: GuildId; channelId: ChannelId }[] = [];
  for (const name of names) {
    const match = STATE_FILE_RE.exec(name);
    if (match === null) {
      continue;
    }
    const guildId = GuildIdSchema.safeParse(match[1]);
    const channelId = ChannelIdSchema.safeParse(match[2]);
    if (guildId.success && channelId.success) {
      sessions.push({ guildId: guildId.data, channelId: channelId.data });
    }
  }
  return sessions;
}

/** Remove a session's resume-state file (best-effort; never throws). */
export async function deleteState(filePath: string): Promise<void> {
  try {
    await rm(filePath, { force: true });
  } catch (error) {
    log.warn("failed to delete resume state", {
      filePath,
      error: getErrorMessage(error),
    });
  }
}

/**
 * Move a session's resume-state file to a new voice channel (best-effort; never throws). Used when a
 * live session is re-keyed to a new channel: the existing snapshot must follow the session so resume
 * still works if the process crashes before the next checkpoint writes the new path.
 *
 * `VOICE_TARGET_MOVED` only updates the machine's context (no state transition), so it triggers no
 * snapshot write. A naive delete-the-old-and-wait would leave a crash window with no state file at
 * either path, losing resume entirely. Instead we write-then-delete: load the old file, rewrite its
 * `guildId`/`channelId` to the new channel (so {@link buildResumeInput}'s channel check passes), save
 * it atomically to the new path, and only then remove the old file. A missing source file is the
 * normal "nothing persisted yet" case — there is nothing to move.
 */
export async function moveState(params: {
  fromPath: string;
  toPath: string;
  guildId: GuildId;
  channelId: ChannelId;
}): Promise<void> {
  const { fromPath, toPath, guildId, channelId } = params;
  if (fromPath === toPath) {
    return;
  }
  let raw: unknown;
  try {
    const file = Bun.file(fromPath);
    if (!(await file.exists())) {
      return;
    }
    raw = await file.json();
  } catch (error) {
    log.warn("could not read resume state to move to new channel path", {
      fromPath,
      toPath,
      error: getErrorMessage(error),
    });
    return;
  }

  const parsed = PersistedStateSchema.safeParse(raw);
  if (!parsed.success) {
    // The old file is unreadable/corrupt — drop it; nothing resumable to carry over.
    log.warn("resume state to move was invalid; dropping it", {
      fromPath,
      issues: z.flattenError(parsed.error),
    });
    await deleteState(fromPath);
    return;
  }

  const moved: PersistedState = { ...parsed.data, guildId, channelId };
  try {
    await saveState(toPath, moved);
  } catch (error) {
    // Could not write the new path — keep the old file so the session can still resume in place.
    log.warn("failed to write moved resume state; keeping original", {
      toPath,
      error: getErrorMessage(error),
    });
    return;
  }
  await deleteState(fromPath);
}

/**
 * Load and validate resume state. Returns `null` (logging the reason) for any non-resumable case —
 * missing file, unreadable/corrupt JSON, schema/version mismatch, or a file older than
 * `maxAgeSeconds`. Resume is best-effort: this never throws, so a bad state file can't break boot.
 */
export async function loadState(
  filePath: string,
  maxAgeSeconds: number,
  nowMs: number = Date.now(),
): Promise<PersistedState | null> {
  let raw: unknown;
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return null;
    }
    raw = await file.json();
  } catch (error) {
    log.warn("resume state unreadable; ignoring", {
      error: getErrorMessage(error),
    });
    return null;
  }

  const parsed = PersistedStateSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn("resume state invalid; ignoring", {
      issues: z.flattenError(parsed.error),
    });
    return null;
  }

  const ageSeconds = (nowMs - parsed.data.savedAt) / 1000;
  if (ageSeconds > maxAgeSeconds) {
    log.info("resume state too old; ignoring", {
      ageSeconds: Math.round(ageSeconds),
      maxAgeSeconds,
    });
    return null;
  }

  return parsed.data;
}

/**
 * Atomically write resume state: write a temp file then `rename` over the target, so a crash mid-write
 * can never leave a half-written file that would fail to load (the rename is atomic on the same fs).
 */
export async function saveState(
  filePath: string,
  state: PersistedState,
): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  await Bun.write(tmp, JSON.stringify(state));
  await rename(tmp, filePath);
}
