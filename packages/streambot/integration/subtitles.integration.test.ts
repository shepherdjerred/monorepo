import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSubtitleFilter } from "@shepherdjerred/streambot/sources/subtitles.ts";
import {
  resolveSubtitleForFile,
  sweepSubtitleTempDir,
} from "@shepherdjerred/streambot/sources/subtitle-io.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";

/**
 * Real-ffmpeg integration tests. These run ONLY via `bun run test:integration` (and the
 * `testStreambotMedia` Dagger target, which runs them inside the streambot image where ffmpeg/ffprobe
 * + libass + fonts are guaranteed). They are NOT part of the plain `bun test` (scoped to `test/`),
 * which runs in a container without ffmpeg. They hard-fail (never skip) if a binary is missing.
 */

const config = loadConfig({
  BOT_TOKEN: "bot-token",
  TOKEN: "user-token",
  GUILD_ID: "208425771172102144",
  COMMAND_CHANNEL_ID: "692223827475824650",
  VIDEO_CHANNEL_ID: "692223827475824650",
  VIDEOS_DIR: "/tmp/videos",
});

const NEVER_ABORT = new AbortController().signal;
const CUE = "HELLO SUBTITLE WORLD";
const SRT = `1\n00:00:00,000 --> 00:00:03,000\n${CUE}\n`;

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `command failed (${String(code)}): ${cmd.join(" ")}\n${stderr.trim().slice(-800)}`,
    );
  }
}

let dir: string;
/** A clip carrying ONLY an embedded subrip subtitle track (no sidecar). */
let embeddedClip: string;
/** A clip with a sibling sidecar `.en.srt` (and no embedded subtitle stream). */
let sidecarClip: string;
/** A clip with no subtitles at all. */
let plainClip: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "streambot-itest-"));
  const srtPath = path.join(dir, "cue.srt");
  await writeFile(srtPath, SRT, "utf8");

  embeddedClip = path.join(dir, "Embedded Movie (2021) Remux-1080p.mkv");
  sidecarClip = path.join(dir, "Sidecar Movie (2021) Remux-1080p.mkv");
  plainClip = path.join(dir, "Plain Movie (2021) Remux-1080p.mkv");

  const lavfi = [
    "-f",
    "lavfi",
    "-i",
    "testsrc=duration=3:size=320x240:rate=10",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
  ];

  // Embedded: mux the SRT in as a subrip subtitle stream tagged English.
  await run([
    config.ffmpegPath,
    "-y",
    ...lavfi,
    "-i",
    srtPath,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-map",
    "2:s",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    "-c:s",
    "srt",
    "-metadata:s:s:0",
    "language=eng",
    embeddedClip,
  ]);

  // Sidecar: no embedded subs; a sibling `.en.srt` instead.
  await run([
    config.ffmpegPath,
    "-y",
    ...lavfi,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    sidecarClip,
  ]);
  await writeFile(
    path.join(dir, "Sidecar Movie (2021) Remux-1080p.en.srt"),
    SRT,
    "utf8",
  );

  // Plain: no subtitles anywhere.
  await run([
    config.ffmpegPath,
    "-y",
    ...lavfi,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    plainClip,
  ]);
});

afterAll(async () => {
  await sweepSubtitleTempDir();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("resolveSubtitleForFile (real ffmpeg/ffprobe)", () => {
  test("finds and stages a sibling sidecar", async () => {
    const resolved = await resolveSubtitleForFile(
      config,
      sidecarClip,
      undefined,
      NEVER_ABORT,
    );
    expect(resolved).toBeDefined();
    if (resolved === undefined) throw new Error("expected a subtitle");
    const text = await readFile(resolved.path, "utf8");
    expect(text).toContain(CUE);
    // Staged to the controlled temp dir, not the user's path.
    expect(resolved.path).toContain("streambot-subs");
    expect(resolved.cleanupPath).toBe(resolved.path);
  });

  test("extracts an embedded text subtitle track when no sidecar exists", async () => {
    const resolved = await resolveSubtitleForFile(
      config,
      embeddedClip,
      undefined,
      NEVER_ABORT,
    );
    expect(resolved).toBeDefined();
    if (resolved === undefined) throw new Error("expected a subtitle");
    const text = await readFile(resolved.path, "utf8");
    expect(text).toContain(CUE);
  });

  test("returns undefined when the file has no subtitles", async () => {
    const resolved = await resolveSubtitleForFile(
      config,
      plainClip,
      undefined,
      NEVER_ABORT,
    );
    expect(resolved).toBeUndefined();
  });

  test("returns undefined when subtitles are disabled for the request", async () => {
    const resolved = await resolveSubtitleForFile(
      config,
      sidecarClip,
      { enabled: false },
      NEVER_ABORT,
    );
    expect(resolved).toBeUndefined();
  });
});

describe("burn-in via the videoFilters chain (real ffmpeg)", () => {
  test("scale + subtitles filter renders a frame and visibly changes pixels", async () => {
    const resolved = await resolveSubtitleForFile(
      config,
      sidecarClip,
      undefined,
      NEVER_ABORT,
    );
    if (resolved === undefined) throw new Error("expected a subtitle");

    const withSubs = path.join(dir, "with-subs.png");
    const without = path.join(dir, "without.png");
    // Grab a frame at t=1s (inside the cue window) with and without the burn.
    await run([
      config.ffmpegPath,
      "-y",
      "-ss",
      "1",
      "-i",
      sidecarClip,
      "-vf",
      `scale=320:240,${buildSubtitleFilter(resolved.path)}`,
      "-frames:v",
      "1",
      withSubs,
    ]);
    await run([
      config.ffmpegPath,
      "-y",
      "-ss",
      "1",
      "-i",
      sidecarClip,
      "-vf",
      "scale=320:240",
      "-frames:v",
      "1",
      without,
    ]);

    const [a, b] = await Promise.all([stat(withSubs), stat(without)]);
    expect(a.size).toBeGreaterThan(0);
    expect(b.size).toBeGreaterThan(0);
    // Burning text changes the frame, so the encoded PNGs must differ.
    const [bufA, bufB] = await Promise.all([
      readFile(withSubs),
      readFile(without),
    ]);
    expect(Buffer.compare(bufA, bufB)).not.toBe(0);
  });
});
