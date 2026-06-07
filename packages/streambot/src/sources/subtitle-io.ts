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
  pickEmbeddedSubtitle,
  pickWrittenSubtitleFile,
  rankSidecars,
  ytdlpSubtitleArgs,
  type EffectiveSubtitleConfig,
  type FfprobeSubtitleStream,
  type SidecarCandidate,
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
}

async function findSidecarFile(
  filePath: string,
  eff: EffectiveSubtitleConfig,
): Promise<string | undefined> {
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
    return undefined;
  }
  const candidates: SidecarCandidate[] = [];
  for (const file of entries) {
    const info = parseSidecarName(file, videoBase);
    if (info !== null) candidates.push({ ...info, file });
  }
  const best = rankSidecars(candidates, eff.languages, eff.pinnedModifier);
  return best === null ? undefined : path.join(dir, best.file);
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

async function extractEmbedded(
  config: Config,
  filePath: string,
  eff: EffectiveSubtitleConfig,
  signal: AbortSignal,
): Promise<ResolvedSubtitle | undefined> {
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
    return undefined;
  }
  let streams: FfprobeSubtitleStream[];
  try {
    streams = parseFfprobeSubtitles(probe.stdout);
  } catch (error) {
    log.warn("could not parse ffprobe subtitle output", {
      error: getErrorMessage(error),
    });
    return undefined;
  }
  const pick = pickEmbeddedSubtitle(streams, eff.languages, eff.pinnedModifier);
  if (pick === null) {
    if (streams.length > 0) {
      log.info("only non-text embedded subtitles; skipping burn-in", {
        file: filePath,
      });
    }
    return undefined;
  }
  const dir = await ensureTempDir();
  const dest = tempFile(dir, "srt");
  const extract = await run(
    [
      config.ffmpegPath,
      "-y",
      "-i",
      filePath,
      "-map",
      `0:s:${String(pick.subtitleIndex)}`,
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
    stream: pick.subtitleIndex,
    codec: pick.codec,
  });
  return { path: dest, cleanupPath: dest };
}

/**
 * Resolve a burnable subtitle for a local file: prefer a sibling sidecar, otherwise extract an embedded
 * text track. Returns undefined when subtitles are disabled or no usable track exists (a normal case —
 * playback continues without subtitles).
 */
export async function resolveSubtitleForFile(
  config: Config,
  filePath: string,
  pref: SubtitlePref | undefined,
  signal: AbortSignal,
): Promise<ResolvedSubtitle | undefined> {
  const eff = effectiveSubtitleConfig(pref, config);
  if (!eff.enabled) return undefined;

  const sidecarPath = await findSidecarFile(filePath, eff);
  if (sidecarPath !== undefined) {
    const staged = await stageSidecar(sidecarPath);
    if (staged !== undefined) return staged;
  }
  return extractEmbedded(config, filePath, eff, signal);
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
