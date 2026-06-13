import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
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
 * lives in {@link file://./subtitles.ts}. Every resolved subtitle is staged to a safe temp file under
 * `os.tmpdir()/streambot-subs/`, so the `subtitles=` filter never references a user path.
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

/** Extract one embedded text track (by subtitle-relative index) to a staged SRT temp file. */
async function extractEmbeddedTrack(
  config: Config,
  filePath: string,
  track: { subtitleIndex: number; codec: string },
  signal: AbortSignal,
): Promise<ResolvedSubtitle | undefined> {
  const { subtitleIndex, codec } = track;
  const dir = await ensureTempDir();
  const dest = tempFile(dir, "srt");
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
      dest,
    ],
    signal,
  );
  if (!extract.ok) {
    log.warn("embedded subtitle extraction failed", {
      file: filePath,
      stderr: extract.stderr.trim().slice(-500),
    });
    return undefined;
  }
  log.info("extracted embedded subtitle", {
    file: filePath,
    stream: subtitleIndex,
    codec,
  });
  return { path: dest, cleanupPath: dest };
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
