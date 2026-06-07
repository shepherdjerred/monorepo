import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { SourceSchema } from "@shepherdjerred/streambot/sources/source.ts";
import { LoopModeSchema } from "@shepherdjerred/streambot/machine/types.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
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
 * On-disk resume state (schema v1). Deliberately stores the original {@link SourceSchema} (re-resolved
 * on boot) rather than the resolved ffmpeg input, because yt-dlp direct URLs are signed and expire.
 * `guildId`/`channelId` are kept only to validate against the live config on boot (don't resume into a
 * stale channel). `resumeAttempts`/`resumeKey` drive the crash-loop guard in `resume.ts`.
 */
export const PersistedStateSchema = z.strictObject({
  version: z.literal(1),
  savedAt: z.number().int().nonnegative(),
  guildId: GuildIdSchema,
  channelId: ChannelIdSchema,
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

/** Absolute path of the resume-state file inside a state directory. */
export function stateFilePath(dir: string): string {
  return path.join(dir, "playback-state.json");
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
