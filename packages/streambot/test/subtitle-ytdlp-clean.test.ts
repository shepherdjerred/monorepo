import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import {
  resolveSubtitleForYtdlp,
  sweepSubtitleTempDir,
} from "@shepherdjerred/streambot/sources/subtitle-io.ts";

/**
 * Offline end-to-end test of the yt-dlp subtitle path. {@link resolveSubtitleForYtdlp} spawns only
 * `yt-dlp` (no ffmpeg), so a single fake `#!/bin/sh` binary covers the whole download → pick → clean →
 * stage pipeline with zero network. The fake parses the real `-o <dir>/<stem>.%(ext)s` template and
 * drops a fixture at `<dir>/<stem>.en.srt`, exactly like yt-dlp; we then assert the staged file that
 * comes out the other end has had its YouTube rolling duplication collapsed (and that clean tracks pass
 * through untouched).
 */

const NEVER_ABORT = new AbortController().signal;
const scratch: string[] = [];

afterEach(async () => {
  for (const dir of scratch.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

afterAll(async () => {
  await sweepSubtitleTempDir();
});

/** A realistic YouTube auto-caption SRT (rolling, with finalization cues) for `hey` / `hello` / `hi`. */
const ROLLING_SRT = `1
00:00:00,000 --> 00:00:01,000
hey

2
00:00:01,000 --> 00:00:01,010
hey

3
00:00:01,010 --> 00:00:02,000
hey
hello

4
00:00:02,000 --> 00:00:02,010
hello

5
00:00:02,010 --> 00:00:03,000
hello
hi

6
00:00:03,000 --> 00:00:03,500
hi
`;

const CLEANED_SRT = `1
00:00:00,000 --> 00:00:01,010
hey

2
00:00:01,010 --> 00:00:02,010
hello

3
00:00:02,010 --> 00:00:03,000
hi
`;

/** A normal human-authored SRT (a wrapped two-line cue included) — must pass through verbatim. */
const CLEAN_SRT = `1
00:00:00,000 --> 00:00:02,000
Hello there.

2
00:00:02,000 --> 00:00:04,000
General Kenobi.

3
00:00:04,000 --> 00:00:06,000
You are a bold one.

4
00:00:06,000 --> 00:00:09,000
Back away. I will deal
with this Jedi slime myself.
`;

async function tmpDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/**
 * Build a fake `yt-dlp` that writes `fixture` (if any) to the SRT path implied by its `-o` template,
 * and a config pointing `YT_DLP_PATH` at it. When `fixture` is null the fake writes nothing (the "no
 * subtitles available" case).
 */
async function setup(
  fixture: string | null,
): Promise<ReturnType<typeof loadConfig>> {
  const bin = await tmpDir("ytclean-bin-");
  let body = "exit 0";
  if (fixture !== null) {
    const fixturePath = path.join(bin, "fixture.srt");
    await writeFile(fixturePath, fixture, "utf8");
    // Parse `-o <dir>/<stem>.%(ext)s`, strip the literal `.%(ext)s` suffix, and write `<stem>.en.srt`.
    body = [
      'out=""',
      'prev=""',
      'for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; done',
      'dest="${out%.%(ext)s}.en.srt"',
      `cp "${fixturePath}" "$dest"`,
    ].join("\n");
  }
  const ytdlp = path.join(bin, "yt-dlp");
  await writeFile(ytdlp, `#!/bin/sh\n${body}\n`);
  await chmod(ytdlp, 0o755);

  return loadConfig({
    BOT_TOKEN: "bot",
    USER_TOKENS: "user",
    VIDEOS_DIR: bin,
    YT_DLP_PATH: ytdlp,
  });
}

describe("resolveSubtitleForYtdlp (fake yt-dlp, end-to-end)", () => {
  test("collapses a rolling YouTube auto-caption into clean single-line cues", async () => {
    const config = await setup(ROLLING_SRT);
    const resolved = await resolveSubtitleForYtdlp(
      config,
      "https://www.youtube.com/watch?v=rolling",
      undefined,
      NEVER_ABORT,
    );
    if (resolved === undefined) throw new Error("expected a resolved subtitle");

    // Staged to the controlled temp dir, one-shot (cleaned in place; the streamer unlinks it).
    expect(resolved.path).toContain("streambot-subs");
    expect(resolved.cleanupPath).toBe(resolved.path);

    const text = await readFile(resolved.path, "utf8");
    expect(text).toBe(CLEANED_SRT);
    // The doubled two-line cue is gone, and each phrase appears exactly once.
    expect(text).not.toContain("hey\nhello");
    expect(text).not.toContain("hello\nhi");
    for (const phrase of ["hey", "hello", "hi"]) {
      expect(text.split(`\n${phrase}\n`).length - 1).toBe(1);
    }
    // 60s: spawns a real process; bun's 5s default flakes under heavy CI load
    // (build 5025 measured 5.4s post-outage). Matches PR #1398's precedent.
  }, 60_000);

  test("leaves an already-clean subtitle track untouched", async () => {
    const config = await setup(CLEAN_SRT);
    const resolved = await resolveSubtitleForYtdlp(
      config,
      "https://www.youtube.com/watch?v=clean",
      undefined,
      NEVER_ABORT,
    );
    if (resolved === undefined) throw new Error("expected a resolved subtitle");
    const text = await readFile(resolved.path, "utf8");
    expect(text).toBe(CLEAN_SRT);
  }, 60_000);

  test("returns undefined when yt-dlp writes no subtitle", async () => {
    const config = await setup(null);
    const resolved = await resolveSubtitleForYtdlp(
      config,
      "https://www.youtube.com/watch?v=none",
      undefined,
      NEVER_ABORT,
    );
    expect(resolved).toBeUndefined();
  }, 60_000);

  test("does nothing when subtitles are disabled for the request", async () => {
    const config = await setup(ROLLING_SRT);
    const resolved = await resolveSubtitleForYtdlp(
      config,
      "https://www.youtube.com/watch?v=rolling",
      { enabled: false },
      NEVER_ABORT,
    );
    expect(resolved).toBeUndefined();
  }, 60_000);
});

describe("resolveSubtitleForYtdlp trackRef bypass (exact pick from the picker)", () => {
  test("an off trackRef returns undefined without invoking yt-dlp", async () => {
    // No fixture written; if yt-dlp were invoked at all this would still resolve undefined, but a
    // failing fake ("exit 1"; no fixture) would surface a mistaken invocation via a thrown error.
    const config = await setup(null);
    const resolved = await resolveSubtitleForYtdlp(
      config,
      "https://www.youtube.com/watch?v=rolling",
      { trackRef: { kind: "off" } },
      NEVER_ABORT,
    );
    expect(resolved).toBeUndefined();
  }, 60_000);

  test("a ytdlp trackRef downloads pinned to that exact language + auto flag", async () => {
    const config = await setup(CLEAN_SRT);
    const resolved = await resolveSubtitleForYtdlp(
      config,
      "https://www.youtube.com/watch?v=clean",
      { trackRef: { kind: "ytdlp", lang: "en", autoGenerated: false } },
      NEVER_ABORT,
    );
    if (resolved === undefined) throw new Error("expected a resolved subtitle");
    const text = await readFile(resolved.path, "utf8");
    expect(text).toBe(CLEAN_SRT);
  }, 60_000);

  test("throws on a non-ytdlp trackRef (invariant: caller contract violation)", async () => {
    const config = await setup(CLEAN_SRT);
    await expect(
      resolveSubtitleForYtdlp(
        config,
        "https://www.youtube.com/watch?v=clean",
        { trackRef: { kind: "sidecar", file: "x.srt" } },
        NEVER_ABORT,
      ),
    ).rejects.toThrow(/non-ytdlp trackRef/u);
  }, 60_000);

  test("an auto-generated pick requests ONLY --write-auto-subs, never --write-subs (regression: mixing both let a same-language manual track silently win over the auto-generated pick)", async () => {
    const { config, argvLog } = await setupWithArgvLog(CLEAN_SRT);
    const resolved = await resolveSubtitleForYtdlp(
      config,
      "https://www.youtube.com/watch?v=clean",
      { trackRef: { kind: "ytdlp", lang: "en", autoGenerated: true } },
      NEVER_ABORT,
    );
    if (resolved === undefined) throw new Error("expected a resolved subtitle");
    const argv = await readFile(argvLog, "utf8");
    expect(argv).toContain("--write-auto-subs");
    expect(argv).not.toContain("--write-subs");
  }, 60_000);

  test("a manual pick requests ONLY --write-subs, never --write-auto-subs", async () => {
    const { config, argvLog } = await setupWithArgvLog(CLEAN_SRT);
    const resolved = await resolveSubtitleForYtdlp(
      config,
      "https://www.youtube.com/watch?v=clean",
      { trackRef: { kind: "ytdlp", lang: "en", autoGenerated: false } },
      NEVER_ABORT,
    );
    if (resolved === undefined) throw new Error("expected a resolved subtitle");
    const argv = await readFile(argvLog, "utf8");
    expect(argv).toContain("--write-subs");
    expect(argv).not.toContain("--write-auto-subs");
  }, 60_000);
});

/**
 * Like {@link setup}, but the fake yt-dlp also appends its full argv (one arg per line, blank line
 * between invocations) to `argvLog`, so a test can assert on exactly which `--write-subs`/
 * `--write-auto-subs` flags a call actually used — the trackRef-bypass path's whole point is to
 * request only one of the two, and `setup`'s fake doesn't distinguish them (it writes the same
 * fixture regardless of which flags were passed).
 */
async function setupWithArgvLog(
  fixture: string,
): Promise<{ config: ReturnType<typeof loadConfig>; argvLog: string }> {
  const bin = await tmpDir("ytclean-argv-bin-");
  const fixturePath = path.join(bin, "fixture.srt");
  await writeFile(fixturePath, fixture, "utf8");
  const argvLog = path.join(bin, "argv.log");
  const body = [
    String.raw`printf "%s\n" "$@" >> ` + JSON.stringify(argvLog),
    String.raw`printf "\n" >> ` + JSON.stringify(argvLog),
    'out=""',
    'prev=""',
    'for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; done',
    'dest="${out%.%(ext)s}.en.srt"',
    `cp "${fixturePath}" "$dest"`,
  ].join("\n");
  const ytdlp = path.join(bin, "yt-dlp");
  await writeFile(ytdlp, `#!/bin/sh\n${body}\n`);
  await chmod(ytdlp, 0o755);

  const config = loadConfig({
    BOT_TOKEN: "bot",
    USER_TOKENS: "user",
    VIDEOS_DIR: bin,
    YT_DLP_PATH: ytdlp,
  });
  return { config, argvLog };
}
