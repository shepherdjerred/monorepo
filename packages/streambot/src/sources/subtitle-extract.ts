import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type {
  ResolvedSubtitle,
  ResolvedTextSubtitle,
} from "@shepherdjerred/streambot/machine/types.ts";
import {
  classifySubtitleCodec,
  embeddedTrackExtractArgs,
  isAssSubtitleCodec,
  parseFontAttachments,
  type FontAttachment,
} from "@shepherdjerred/streambot/sources/subtitle-formats.ts";
import {
  ensureTempDir,
  runSubtitleProcess,
  subtitleLog as log,
} from "@shepherdjerred/streambot/sources/subtitle-process.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";

/**
 * Embedded-track staging for a local file. An image track (PGS/VobSub/DVB) needs nothing staged —
 * the streamer overlays the playback input's own subtitle stream. A text track is extracted in one
 * full-demux pass: ASS/SSA as `.ass` with the source's font attachments dumped next to it (libass
 * `fontsdir`), anything else as `.srt`. Extractions are cached in `config.subtitles.cacheDir` when
 * set (`<key>.<ext>`, fonts in `<key>.fonts/`), otherwise staged in a one-shot per-item directory
 * in the swept temp dir that the streamer removes when the stream ends.
 */

type EmbeddedTrack = { subtitleIndex: number; codec: string };

/** Where a cached extraction lives: the track file and (for ASS) its fonts directory. */
type CacheTarget = { readonly path: string; readonly fontsDir: string };

/**
 * Cheap, content-free cache key for an extracted embedded track: SHA-256 over the file's identity
 * (absolute path + byte size + mtime) and the subtitle-relative stream index. Deliberately does NOT
 * hash the file's bytes — a remux is tens of GB, so hashing it would cost more than the extraction
 * this key exists to skip. Size+mtime invalidate the entry when the file is replaced or re-encoded,
 * the same approach Plex uses. Returns null if the file can't be stat'd (caller falls back
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
 * The cache target for a track, or null when caching is disabled, the file can't be stat'd, or the
 * cache dir can't be created — each falls back to an uncached extraction.
 */
async function cacheTarget(
  config: Config,
  filePath: string,
  subtitleIndex: number,
  ext: string,
): Promise<CacheTarget | null> {
  const cacheDir = config.subtitles.cacheDir;
  if (cacheDir === undefined) return null;
  const key = await embeddedCacheKey(filePath, subtitleIndex);
  if (key === null) return null;
  try {
    await mkdir(cacheDir, { recursive: true });
  } catch (error) {
    log.warn("subtitle cache dir unavailable; extracting to temp instead", {
      dir: cacheDir,
      error: getErrorMessage(error),
    });
    return null;
  }
  const base = path.join(cacheDir, key);
  return { path: `${base}.${ext}`, fontsDir: `${base}.fonts` };
}

async function isDirectory(dir: string): Promise<boolean> {
  const st = await stat(dir).catch(() => null);
  return st?.isDirectory() === true;
}

function textSubtitle(
  trackPath: string,
  fontsDir: string | undefined,
  cleanupPath?: string,
): ResolvedTextSubtitle {
  return {
    kind: "text",
    path: trackPath,
    ...(fontsDir === undefined ? {} : { fontsDir }),
    ...(cleanupPath === undefined ? {} : { cleanupPath }),
  };
}

/** The source's font attachments (MKV) for an ASS track — [] when there are none or probing fails. */
async function probeFontAttachments(
  config: Config,
  filePath: string,
  signal: AbortSignal,
): Promise<FontAttachment[]> {
  const probe = await runSubtitleProcess(
    [
      config.ffprobePath,
      "-v",
      "error",
      "-select_streams",
      "t",
      "-show_streams",
      "-of",
      "json",
      filePath,
    ],
    signal,
  );
  if (!probe.ok) {
    log.warn(
      "could not probe font attachments; ASS renders with system fonts",
      { file: filePath, stderr: probe.stderr.trim().slice(-500) },
    );
    return [];
  }
  try {
    return parseFontAttachments(probe.stdout);
  } catch (error) {
    log.warn(
      "could not parse font attachments; ASS renders with system fonts",
      { file: filePath, error: getErrorMessage(error) },
    );
    return [];
  }
}

/**
 * Extract a track into `stagingDir` (`track.<ext>`, fonts in `fonts/`). The track keeps its real
 * extension as the FINAL one and `-f` pins the muxer anyway (PR #1172 used `.srt.tmp` and broke
 * every extraction with "Unable to choose an output format"). Removes the directory and returns
 * undefined on failure. The returned subtitle's `cleanupPath` is the staging directory.
 */
async function extractToStaging(
  config: Config,
  job: { filePath: string; track: EmbeddedTrack; stagingDir: string },
  signal: AbortSignal,
): Promise<ResolvedTextSubtitle | undefined> {
  const { filePath, track, stagingDir } = job;
  const ass = isAssSubtitleCodec(track.codec);
  const dest = path.join(stagingDir, `track.${ass ? "ass" : "srt"}`);
  const fontsDir = path.join(stagingDir, "fonts");
  const fonts = ass ? await probeFontAttachments(config, filePath, signal) : [];
  await mkdir(fonts.length > 0 ? fontsDir : stagingDir, { recursive: true });
  const extract = await runSubtitleProcess(
    [
      config.ffmpegPath,
      ...embeddedTrackExtractArgs({
        filePath,
        subtitleIndex: track.subtitleIndex,
        codec: track.codec,
        dest,
        fonts: fonts.map((font) => ({
          attachmentIndex: font.attachmentIndex,
          path: path.join(fontsDir, font.fileName),
        })),
      }),
    ],
    signal,
  );
  if (!extract.ok) {
    await rm(stagingDir, { recursive: true, force: true });
    log.warn("embedded subtitle extraction failed", {
      file: filePath,
      stderr: extract.stderr.trim().slice(-500),
    });
    return undefined;
  }
  log.info("extracted embedded subtitle", {
    file: filePath,
    stream: track.subtitleIndex,
    codec: track.codec,
    fonts: fonts.length,
  });
  return textSubtitle(
    dest,
    fonts.length > 0 ? fontsDir : undefined,
    stagingDir,
  );
}

/**
 * Publish a staged extraction to the cache: fonts first, so a reader that finds the cached track
 * also finds its fonts. A concurrent extraction of the same track may already have published the
 * fonts (the directory rename then fails because the target exists); they are the same
 * attachments, so keep them. On Linux, rename(2) atomically replaces an existing track file, so the
 * last track rename wins. If publishing fails (disk full, permissions, cross-device rename) the
 * staged copy serves this run as a one-shot temp and the cache fills on a later play.
 */
async function publishToCache(
  staged: ResolvedTextSubtitle,
  target: CacheTarget,
): Promise<ResolvedTextSubtitle> {
  try {
    if (staged.fontsDir !== undefined) {
      await rename(staged.fontsDir, target.fontsDir).catch(
        async (error: unknown) => {
          if (!(await isDirectory(target.fontsDir))) throw error;
        },
      );
    }
    await rename(staged.path, target.path);
  } catch (error) {
    log.warn(
      "could not publish subtitle to cache; using staged copy this run",
      { cachePath: target.path, error: getErrorMessage(error) },
    );
    // The fonts may already have moved into the cache before the track rename failed.
    const fontsDir =
      staged.fontsDir === undefined || (await isDirectory(staged.fontsDir))
        ? staged.fontsDir
        : target.fontsDir;
    return textSubtitle(staged.path, fontsDir, staged.cleanupPath);
  }
  if (staged.cleanupPath !== undefined) {
    await rm(staged.cleanupPath, { recursive: true, force: true });
  }
  log.info("published embedded subtitle to cache", {
    cachePath: target.path,
  });
  return textSubtitle(
    target.path,
    staged.fontsDir === undefined ? undefined : target.fontsDir,
  );
}

/**
 * Extract one embedded text track (by subtitle-relative index). A cached entry has no
 * `cleanupPath` (the streamer must not remove the shared copy); an uncached one is staged in a
 * per-item temp directory that is its `cleanupPath`.
 */
async function extractEmbeddedTrack(
  config: Config,
  filePath: string,
  track: EmbeddedTrack,
  signal: AbortSignal,
): Promise<ResolvedTextSubtitle | undefined> {
  const ass = isAssSubtitleCodec(track.codec);
  const target = await cacheTarget(
    config,
    filePath,
    track.subtitleIndex,
    ass ? "ass" : "srt",
  );
  if (target !== null && (await Bun.file(target.path).exists())) {
    log.info("embedded subtitle cache hit", {
      file: filePath,
      stream: track.subtitleIndex,
      codec: track.codec,
    });
    const hasFonts = ass && (await isDirectory(target.fontsDir));
    return textSubtitle(target.path, hasFonts ? target.fontsDir : undefined);
  }
  // Uncached: a per-item temp directory (the cleanup unit). Cached: a hidden sibling in the cache
  // dir, so publishing is a same-filesystem rename and an aborted ffmpeg never leaves a truncated
  // cache entry.
  const stagingDir =
    target === null
      ? path.join(await ensureTempDir(), randomUUID())
      : path.join(path.dirname(target.path), `.${randomUUID()}.tmp`);
  const staged = await extractToStaging(
    config,
    { filePath, track, stagingDir },
    signal,
  );
  return staged === undefined || target === null
    ? staged
    : publishToCache(staged, target);
}

/**
 * Stage an embedded track for burning. An image track resolves instantly to the input's own
 * stream (no full-demux extraction); a text track is extracted (and cached).
 */
export async function stageEmbeddedTrack(
  config: Config,
  filePath: string,
  track: EmbeddedTrack,
  signal: AbortSignal,
): Promise<ResolvedSubtitle | undefined> {
  if (classifySubtitleCodec(track.codec) === "image") {
    log.info("using embedded image subtitle", {
      file: filePath,
      stream: track.subtitleIndex,
      codec: track.codec,
    });
    return {
      kind: "image",
      subtitleIndex: track.subtitleIndex,
      codec: track.codec,
    };
  }
  return extractEmbeddedTrack(config, filePath, track, signal);
}
