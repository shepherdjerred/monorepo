import { randomUUID } from "node:crypto";
import { copyFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type {
  SubtitlePref,
  SubtitleTrackRef,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { ResolvedSubtitle } from "@shepherdjerred/streambot/machine/types.ts";
import { cleanRollingSrt } from "@shepherdjerred/streambot/sources/subtitle-clean.ts";
import { stageEmbeddedTrack } from "@shepherdjerred/streambot/sources/subtitle-extract.ts";
import {
  ensureTempDir,
  runSubtitleProcess as run,
  subtitleLog as log,
  tempFile,
} from "@shepherdjerred/streambot/sources/subtitle-process.ts";
import {
  effectiveSubtitleConfig,
  isAutoBurnLanguage,
  parseFfprobeSubtitles,
  parseSidecarName,
  pickWrittenSubtitleFile,
  rankSubtitleCandidates,
  toEmbeddedCandidates,
  ytdlpSubtitleArgs,
  type FfprobeSubtitleStream,
  type SubtitleCandidate,
  type YtdlpSubtitleKinds,
} from "@shepherdjerred/streambot/sources/subtitles.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";

/**
 * Subtitle I/O glue: temp staging + ffprobe/ffmpeg/yt-dlp. Pure logic (ranking, parsing, escaping)
 * lives in {@link file://./subtitles.ts}. Sidecars and yt-dlp downloads are staged to a safe temp
 * file under `os.tmpdir()/streambot-subs/`; extracted embedded text tracks (plus the fonts an ASS
 * track needs) are persisted to `config.subtitles.cacheDir` when set (reused across plays) and fall
 * back to a per-item directory in the same temp dir otherwise — so the `subtitles=` filter never
 * references a user path either way. Embedded image tracks are not staged at all: ffmpeg overlays
 * the playback input's own subtitle stream.
 */

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
    return { kind: "text", path: dest, cleanupPath: dest };
  } catch (error) {
    log.warn("failed to stage sidecar subtitle", {
      source: sourcePath,
      error: getErrorMessage(error),
    });
    return undefined;
  }
}

/** All burnable embedded (text and image) track candidates from ffprobe — unranked; [] on any failure. */
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
  return toEmbeddedCandidates(streams);
}

/**
 * Enumerate every burnable subtitle candidate (sidecar + embedded) for a local file, ranked
 * best-first by the server's configured language preference — for `/stream subtitles`'s track
 * picker. Unlike {@link resolveSubtitleForFile}, this never stages/extracts anything; it's a pure
 * listing so the user can pick before any I/O happens.
 */
export async function listSubtitleCandidatesForFile(
  config: Config,
  filePath: string,
  signal: AbortSignal,
): Promise<SubtitleCandidate[]> {
  const sidecars = await gatherSidecarCandidates(filePath);
  const embedded = await probeEmbeddedCandidates(config, filePath, signal);
  return rankSubtitleCandidates(
    [...sidecars, ...embedded],
    config.subtitles.languages,
    null,
  );
}

/** Apply an exact track pick for a local file — no gathering/ranking, just stage/extract that one track. */
async function resolveExactTrackForFile(
  config: Config,
  filePath: string,
  trackRef: SubtitleTrackRef,
  signal: AbortSignal,
): Promise<ResolvedSubtitle | undefined> {
  switch (trackRef.kind) {
    case "off":
      return undefined;
    case "sidecar":
      return stageSidecar(path.join(path.dirname(filePath), trackRef.file));
    case "embedded":
      return stageEmbeddedTrack(
        config,
        filePath,
        { subtitleIndex: trackRef.subtitleIndex, codec: trackRef.codec },
        signal,
      );
    case "ytdlp":
      throw new Error(
        "invariant: a ytdlp trackRef was passed to the file subtitle resolver",
      );
  }
}

/**
 * Resolve a burnable subtitle for a local file. Sidecars and embedded text and image tracks compete
 * in ONE cross-source ranking (language → full/SDH/forced quality → sidecar, embedded text, then
 * embedded image), so a forced-only sidecar no longer shadows a full embedded track. Only tracks in
 * a preferred (or unknown) language are eligible: a film whose only subtitles are foreign plays
 * without them unless the user picks one explicitly. Candidates are staged in ranked order — a
 * stage/extract failure falls through to the next-best track. Returns undefined when subtitles are
 * disabled or no eligible track exists (a normal case — playback continues without subtitles).
 */
export async function resolveSubtitleForFile(
  config: Config,
  filePath: string,
  pref: SubtitlePref | undefined,
  signal: AbortSignal,
): Promise<ResolvedSubtitle | undefined> {
  // A trackRef (from `/stream subtitles`'s picker) names an EXACT track — bypass ranking/config
  // defaults entirely (an explicit pick applies even if subtitles are config-disabled by default).
  if (pref?.trackRef !== undefined) {
    return resolveExactTrackForFile(config, filePath, pref.trackRef, signal);
  }

  const eff = effectiveSubtitleConfig(pref, config);
  if (!eff.enabled) return undefined;

  // Best-effort: any unexpected failure (fs, ffprobe/ffmpeg missing, temp-dir error) degrades to
  // "no subtitle" rather than aborting playback.
  try {
    const sidecars = await gatherSidecarCandidates(filePath);
    const embedded = await probeEmbeddedCandidates(config, filePath, signal);
    const all = [...sidecars, ...embedded];
    const ranked = rankSubtitleCandidates(
      all.filter((candidate) =>
        isAutoBurnLanguage(candidate.lang, eff.languages),
      ),
      eff.languages,
      eff.pinnedModifier,
    );
    if (ranked.length === 0 && all.length > 0) {
      log.info("no subtitle track in a preferred language; not auto-burning", {
        file: filePath,
        languages: eff.languages,
        available: [...new Set(all.map((candidate) => candidate.lang))],
      });
    }
    for (const candidate of ranked) {
      if (candidate.kind === "ytdlp") {
        throw new Error(
          "invariant: file subtitle ranking produced a yt-dlp candidate",
        );
      }
      const staged =
        candidate.kind === "sidecar"
          ? await stageSidecar(
              path.join(path.dirname(filePath), candidate.file),
            )
          : await stageEmbeddedTrack(config, filePath, candidate, signal);
      if (staged !== undefined) {
        log.info("subtitle selected", {
          file: filePath,
          kind: candidate.kind,
          format: staged.kind,
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
 * Download + convert-to-SRT the best-matching subtitle/caption track yt-dlp reports for `target`,
 * pinned to exactly `langPrefs`/`kinds`. Shared by the ranking path (`langPrefs` = the server's
 * configured languages, `kinds` = manual-always/auto-if-configured) and the exact-pick path
 * (`langPrefs` = a single trackRef language, `kinds` = exactly the one kind the user picked) — a
 * single language list degenerates `pickWrittenSubtitleFile`'s ranking to "pick that one," so this
 * one download routine serves both callers unchanged.
 */
async function downloadYtdlpSubtitle(
  config: Config,
  target: string,
  pick: { langPrefs: readonly string[]; kinds: YtdlpSubtitleKinds },
  signal: AbortSignal,
): Promise<ResolvedSubtitle | undefined> {
  const { langPrefs, kinds } = pick;
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
  const args = ytdlpSubtitleArgs(target, langPrefs, kinds, outputTemplate);
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
  const picked = pickWrittenSubtitleFile(written, langPrefs);
  if (picked === null) {
    log.info("no subtitles available for source", { target });
    return undefined;
  }
  const full = path.join(dir, picked);
  await cleanRollingSubtitleFile(full);
  log.info("downloaded subtitle for source", { target, file: picked });
  return { kind: "text", path: full, cleanupPath: full };
}

/** Apply an exact track pick for a yt-dlp target — no ranking, pinned to one language + auto-flag. */
async function resolveExactTrackForYtdlp(
  config: Config,
  target: string,
  trackRef: SubtitleTrackRef,
  signal: AbortSignal,
): Promise<ResolvedSubtitle | undefined> {
  if (trackRef.kind === "off") {
    return undefined;
  }
  if (trackRef.kind !== "ytdlp") {
    throw new Error(
      "invariant: a non-ytdlp trackRef was passed to the yt-dlp subtitle resolver",
    );
  }
  return downloadYtdlpSubtitle(
    config,
    target,
    {
      langPrefs: [trackRef.lang],
      // Mutually exclusive: an exact pick must fetch ONLY the kind the user chose — requesting
      // both would let a same-language manual track win over the auto-generated pick (or vice
      // versa), since pickWrittenSubtitleFile ranks by language/format only, not manual-vs-auto.
      kinds: {
        manual: !trackRef.autoGenerated,
        auto: trackRef.autoGenerated,
      },
    },
    signal,
  );
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
  if (pref?.trackRef !== undefined) {
    return resolveExactTrackForYtdlp(config, target, pref.trackRef, signal);
  }

  const eff = effectiveSubtitleConfig(pref, config);
  if (!eff.enabled) return undefined;

  return downloadYtdlpSubtitle(
    config,
    target,
    {
      langPrefs: eff.languages,
      kinds: { manual: true, auto: config.subtitles.includeAutoGenerated },
    },
    signal,
  );
}

/**
 * Best-effort in-place cleanup of YouTube auto-caption "rolling" duplication on a staged `.srt`, so
 * libass burns one clean line at a time instead of the doubled/stale two-line scroll. Only `.srt` (the
 * format yt-dlp converts to) is considered; {@link cleanRollingSrt} returns null for an already-clean
 * track and any read/parse/write failure leaves the original file untouched (subtitles never abort
 * playback).
 */
async function cleanRollingSubtitleFile(file: string): Promise<void> {
  if (path.extname(file).toLowerCase() !== ".srt") return;
  try {
    const original = await Bun.file(file).text();
    const cleaned = cleanRollingSrt(original);
    if (cleaned === null) return;
    await Bun.write(file, cleaned);
    log.info("collapsed rolling auto-caption subtitle", { file });
  } catch (error) {
    log.warn("failed to clean rolling subtitle; using original", {
      file,
      error: getErrorMessage(error),
    });
  }
}
