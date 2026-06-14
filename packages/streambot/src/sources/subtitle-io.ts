import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { SubtitlePref } from "@shepherdjerred/streambot/sources/source.ts";
import type { ResolvedSubtitle } from "@shepherdjerred/streambot/machine/types.ts";
import {
  effectiveSubtitleConfig,
  parseFfprobeSubtitles,
  parseSidecarName,
  pickWrittenSubtitleFile,
  rankSubtitleCandidates,
  toEmbeddedCandidates,
  ytdlpSubtitleArgs,
  type FfprobeSubtitleStream,
  type SubtitleCandidate,
} from "@shepherdjerred/streambot/sources/subtitles.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

/**
 * Subtitle I/O glue: temp staging + ffprobe/ffmpeg/yt-dlp. Pure logic (ranking, parsing, escaping)
 * lives in {@link file://./subtitles.ts}. Sidecars and yt-dlp downloads are staged to a safe temp
 * file under `os.tmpdir()/streambot-subs/`; extracted embedded tracks are persisted to
 * `config.subtitles.cacheDir` when set (reused across plays) and fall back to the same temp dir
 * otherwise — so the `subtitles=` filter never references a user path either way.
 */

const log = logger.child("subtitles");

function subsTempDir(): string {
  return path.join(os.tmpdir(), "streambot-subs");
}

async function ensureTempDir(): Promise<string> {
  const dir = subsTempDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

function tempFile(dir: string, ext: string): string {
  return path.join(dir, `${randomUUID()}.${ext}`);
}

/** Remove all staged subtitle temp files. Call once at startup to clear orphans from a previous run. */
export async function sweepSubtitleTempDir(): Promise<void> {
  try {
    await rm(subsTempDir(), { recursive: true, force: true });
  } catch (error) {
    log.warn("failed to sweep subtitle temp dir", {
      error: getErrorMessage(error),
    });
  }
}

type ProcResult = { ok: boolean; stdout: string; stderr: string };

async function run(cmd: string[], signal: AbortSignal): Promise<ProcResult> {
  // Subtitles are best-effort: a missing binary (ENOENT from Bun.spawn), an abort, or any spawn
  // failure must degrade to "no subtitle", never throw through resolution and abort playback.
  try {
    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      signal,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0, stdout, stderr };
  } catch (error) {
    log.warn("subtitle subprocess failed to run", {
      command: cmd[0],
      error: getErrorMessage(error),
    });
    return { ok: false, stdout: "", stderr: getErrorMessage(error) };
  }
}

/** All sidecar candidates next to the video (Plex/Bazarr naming) — unranked. */
async function gatherSidecarCandidates(
  filePath: string,
): Promise<SubtitleCandidate[]> {
  const dir = path.dirname(filePath);
  const videoBase = path.basename(filePath, path.extname(filePath));
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    log.warn("could not read directory for sidecar subtitles", {
      dir,
      error: getErrorMessage(error),
    });
    return [];
  }
  const candidates: SubtitleCandidate[] = [];
  for (const file of entries) {
    const info = parseSidecarName(file, videoBase);
    if (info !== null) candidates.push({ kind: "sidecar", ...info, file });
  }
  return candidates;
}

async function stageSidecar(
  sourcePath: string,
): Promise<ResolvedSubtitle | undefined> {
  try {
    const dir = await ensureTempDir();
    const ext = path.extname(sourcePath).slice(1).toLowerCase() || "srt";
    const dest = tempFile(dir, ext);
    await copyFile(sourcePath, dest);
    log.info("using sidecar subtitle", { source: sourcePath });
    return { path: dest, cleanupPath: dest };
  } catch (error) {
    log.warn("failed to stage sidecar subtitle", {
      source: sourcePath,
      error: getErrorMessage(error),
    });
    return undefined;
  }
}

/** All burnable embedded text-track candidates from ffprobe — unranked; [] on any failure. */
async function probeEmbeddedCandidates(
  config: Config,
  filePath: string,
  signal: AbortSignal,
): Promise<SubtitleCandidate[]> {
  const probe = await run(
    [
      config.ffprobePath,
      "-v",
      "error",
      "-select_streams",
      "s",
      "-show_streams",
      "-of",
      "json",
      filePath,
    ],
    signal,
  );
  if (!probe.ok) {
    log.debug("ffprobe found no subtitle streams (or failed)", {
      file: filePath,
    });
    return [];
  }
  let streams: FfprobeSubtitleStream[];
  try {
    streams = parseFfprobeSubtitles(probe.stdout);
  } catch (error) {
    log.warn("could not parse ffprobe subtitle output", {
      error: getErrorMessage(error),
    });
    return [];
  }
  const candidates = toEmbeddedCandidates(streams);
  if (streams.length > 0 && candidates.length === 0) {
    log.info("embedded subtitles are image-only (PGS/VobSub); cannot burn", {
      file: filePath,
    });
  }
  return candidates;
}

/**
 * Cheap, content-free cache key for an extracted embedded track: SHA-256 over the file's identity
 * (absolute path + byte size + mtime) and the subtitle-relative stream index. Deliberately does NOT
 * hash the file's bytes — a remux is tens of GB, so hashing it would cost more than the extraction
 * this key exists to skip. Size+mtime invalidate the entry when the file is replaced or re-encoded,
 * the same approach Plex/Jellyfin use. Returns null if the file can't be stat'd (caller falls back
 * to an uncached temp extraction). The `s<i>` separator keeps multi-track files from colliding.
 */
async function embeddedCacheKey(
  filePath: string,
  subtitleIndex: number,
): Promise<string | null> {
  try {
    const st = await stat(filePath);
    return createHash("sha256")
      .update(
        `${filePath}\0${String(st.size)}\0${String(Math.trunc(st.mtimeMs))}\0s${String(subtitleIndex)}`,
      )
      .digest("hex");
  } catch (error) {
    log.warn("could not stat file for subtitle cache key", {
      file: filePath,
      error: getErrorMessage(error),
    });
    return null;
  }
}

/**
 * Extract one embedded text track (by subtitle-relative index) to an SRT file. When
 * `config.subtitles.cacheDir` is set, the result is cached there keyed by {@link embeddedCacheKey} so
 * the slow full-demux extraction runs once per file and every later play reuses it instantly; a
 * cached entry has no `cleanupPath` (the streamer must not unlink the shared copy). Without a cache
 * dir (or if its directory is unwritable / the file can't be stat'd) it falls back to the old
 * behaviour: a one-shot temp file in the swept temp dir.
 */
async function extractEmbeddedTrack(
  config: Config,
  filePath: string,
  track: { subtitleIndex: number; codec: string },
  signal: AbortSignal,
): Promise<ResolvedSubtitle | undefined> {
  const { subtitleIndex, codec } = track;

  // Resolve the cache target up front. cachePath stays null when caching is disabled, the file
  // can't be stat'd, or the cache dir can't be created — each falls back to an uncached extraction.
  let cachePath: string | null = null;
  if (config.subtitles.cacheDir !== undefined) {
    const key = await embeddedCacheKey(filePath, subtitleIndex);
    if (key !== null) {
      const cacheDir = config.subtitles.cacheDir;
      try {
        await mkdir(cacheDir, { recursive: true });
        cachePath = path.join(cacheDir, `${key}.srt`);
      } catch (error) {
        log.warn("subtitle cache dir unavailable; extracting to temp instead", {
          dir: cacheDir,
          error: getErrorMessage(error),
        });
      }
    }
  }

  if (cachePath !== null && (await Bun.file(cachePath).exists())) {
    log.info("embedded subtitle cache hit", {
      file: filePath,
      stream: subtitleIndex,
      codec,
    });
    return { path: cachePath };
  }

  // Extract to a staging file: a temp-dir file when uncached, or a sibling temp in the cache dir (so
  // the publish rename is atomic and a crashed/aborted ffmpeg never leaves a truncated cache entry).
  const staging =
    cachePath === null
      ? tempFile(await ensureTempDir(), "srt")
      : path.join(path.dirname(cachePath), `.${randomUUID()}.srt.tmp`);
  const extract = await run(
    [
      config.ffmpegPath,
      "-y",
      "-i",
      filePath,
      "-map",
      `0:s:${String(subtitleIndex)}`,
      "-c:s",
      "srt",
      staging,
    ],
    signal,
  );
  if (!extract.ok) {
    await rm(staging, { force: true });
    log.warn("embedded subtitle extraction failed", {
      file: filePath,
      stderr: extract.stderr.trim().slice(-500),
    });
    return undefined;
  }

  if (cachePath === null) {
    log.info("extracted embedded subtitle", {
      file: filePath,
      stream: subtitleIndex,
      codec,
    });
    return { path: staging, cleanupPath: staging };
  }

  try {
    await rename(staging, cachePath);
  } catch (error) {
    // Couldn't publish to the cache (e.g. disk-full, permission error, or cross-device rename).
    // Use the staged copy for this run as a one-shot temp; the cache fills on a later play.
    // Note: on Linux, rename(2) atomically replaces an existing destination, so concurrent
    // extractions of the same file do not cause a failure here — the last rename wins.
    log.warn(
      "could not publish subtitle to cache; using staged copy this run",
      {
        cachePath,
        error: getErrorMessage(error),
      },
    );
    return { path: staging, cleanupPath: staging };
  }
  log.info("extracted embedded subtitle (cached)", {
    file: filePath,
    stream: subtitleIndex,
    codec,
    cachePath,
  });
  return { path: cachePath };
}

/**
 * Resolve a burnable subtitle for a local file. Sidecars and embedded text tracks compete in ONE
 * cross-source ranking (language → full/SDH/forced quality → sidecar-first tie-break), so a
 * forced-only sidecar no longer shadows a full embedded track. Candidates are staged in ranked
 * order — a stage/extract failure falls through to the next-best track. Returns undefined when
 * subtitles are disabled or no usable track exists (a normal case — playback continues without
 * subtitles).
 */
export async function resolveSubtitleForFile(
  config: Config,
  filePath: string,
  pref: SubtitlePref | undefined,
  signal: AbortSignal,
): Promise<ResolvedSubtitle | undefined> {
  const eff = effectiveSubtitleConfig(pref, config);
  if (!eff.enabled) return undefined;

  // Best-effort: any unexpected failure (fs, ffprobe/ffmpeg missing, temp-dir error) degrades to
  // "no subtitle" rather than aborting playback.
  try {
    const sidecars = await gatherSidecarCandidates(filePath);
    const embedded = await probeEmbeddedCandidates(config, filePath, signal);
    const ranked = rankSubtitleCandidates(
      [...sidecars, ...embedded],
      eff.languages,
      eff.pinnedModifier,
    );
    for (const candidate of ranked) {
      const staged =
        candidate.kind === "sidecar"
          ? await stageSidecar(
              path.join(path.dirname(filePath), candidate.file),
            )
          : await extractEmbeddedTrack(config, filePath, candidate, signal);
      if (staged !== undefined) {
        log.info("subtitle selected", {
          file: filePath,
          kind: candidate.kind,
          lang: candidate.lang,
          modifier: candidate.modifier,
        });
        return staged;
      }
    }
    return undefined;
  } catch (error) {
    log.warn("subtitle resolution failed; continuing without subtitles", {
      file: filePath,
      error: getErrorMessage(error),
    });
    return undefined;
  }
}

/**
 * Resolve a burnable subtitle for a yt-dlp target (URL or `ytsearch1:` query) by downloading the
 * preferred subtitle/caption track and converting it to SRT. Best-effort: returns undefined (no
 * subtitles) on any failure or when none are available.
 */
export async function resolveSubtitleForYtdlp(
  config: Config,
  target: string,
  pref: SubtitlePref | undefined,
  signal: AbortSignal,
): Promise<ResolvedSubtitle | undefined> {
  const eff = effectiveSubtitleConfig(pref, config);
  if (!eff.enabled) return undefined;

  let dir: string;
  try {
    dir = await ensureTempDir();
  } catch (error) {
    log.warn("could not create subtitle temp dir", {
      error: getErrorMessage(error),
    });
    return undefined;
  }
  const stem = randomUUID();
  const outputTemplate = path.join(dir, `${stem}.%(ext)s`);
  const args = ytdlpSubtitleArgs(
    target,
    eff.languages,
    config.subtitles.includeAutoGenerated,
    outputTemplate,
  );
  // yt-dlp can exit non-zero when a source simply has no subtitles; we don't treat that as fatal —
  // we just inspect what (if anything) it wrote.
  await run([config.ytDlpPath, ...args], signal);

  let written: string[];
  try {
    const entries = await readdir(dir);
    written = entries.filter((f) => f.startsWith(stem));
  } catch (error) {
    log.warn("could not list downloaded subtitles", {
      error: getErrorMessage(error),
    });
    return undefined;
  }
  const picked = pickWrittenSubtitleFile(written, eff.languages);
  if (picked === null) {
    log.info("no subtitles available for source", { target });
    return undefined;
  }
  const full = path.join(dir, picked);
  log.info("downloaded subtitle for source", { target, file: picked });
  return { path: full, cleanupPath: full };
}
