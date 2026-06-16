import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { resolveSubtitleForFile } from "@shepherdjerred/streambot/sources/subtitle-io.ts";

/**
 * Drives the real {@link resolveSubtitleForFile} I/O path with fake `ffprobe`/`ffmpeg` shell scripts
 * so the embedded-subtitle cache can be tested deterministically (no real media or ffmpeg). The point
 * under test: the expensive extraction runs once per (file, stream) and every later play is a cache
 * hit that reuses the persisted `.srt` — and a cached entry carries no `cleanupPath`, so the streamer
 * never unlinks the shared copy.
 */

const scratch: string[] = [];

afterEach(async () => {
  for (const dir of scratch.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function tmpDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** Write an executable `#!/bin/sh` fake that appends a line to `callLog` then runs `body`. */
async function fakeBin(
  dir: string,
  name: string,
  callLog: string,
  body: string,
): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(
    file,
    `#!/bin/sh\nprintf '%s\\n' "${name}" >> "${callLog}"\n${body}\n`,
  );
  await chmod(file, 0o755);
  return file;
}

async function callCount(log: string): Promise<number> {
  const text = await readFile(log, "utf8");
  return text.split("\n").filter((line) => line.length > 0).length;
}

type Fakes = {
  config: ReturnType<typeof loadConfig>;
  moviePath: string;
  cacheDir: string;
  ffmpegLog: string;
};

async function setup(withCache: boolean): Promise<Fakes> {
  const bin = await tmpDir("subcache-bin-");
  const media = await tmpDir("subcache-media-");
  const cacheDir = await tmpDir("subcache-cache-");
  const ffmpegLog = path.join(bin, "ffmpeg.calls");
  const ffprobeLog = path.join(bin, "ffprobe.calls");

  // One burnable embedded English subrip track.
  const ffprobe = await fakeBin(
    bin,
    "ffprobe",
    ffprobeLog,
    `printf '{"streams":[{"codec_name":"subrip","tags":{"language":"eng"}}]}'`,
  );
  // Write a minimal SRT to the dest (the last positional arg), mimicking `-c:s srt <dest>`. The
  // dest-must-end-in-`.srt` guard mirrors real ffmpeg's muxer auto-detect: it picks the output format
  // from the trailing extension and errors on anything unknown (PR #1172 shipped `.srt.tmp` and broke
  // every cached extraction in prod). Keep this guard — it's the regression test for that class of bug.
  const ffmpeg = await fakeBin(
    bin,
    "ffmpeg",
    ffmpegLog,
    `for dest in "$@"; do :; done\ncase "$dest" in *.srt) ;; *) echo "fake-ffmpeg: dest must end in .srt, got: $dest" >&2; exit 1 ;; esac\nprintf '1\\n00:00:01,000 --> 00:00:02,000\\nhi\\n' > "$dest"`,
  );

  const moviePath = path.join(media, "Movie.mkv");
  await writeFile(moviePath, "pretend-video-bytes");

  const config = loadConfig({
    BOT_TOKEN: "bot",
    USER_TOKENS: "user",
    VIDEOS_DIR: media,
    FFMPEG_PATH: ffmpeg,
    FFPROBE_PATH: ffprobe,
    ...(withCache ? { SUBS_CACHE_DIR: cacheDir } : {}),
  });

  return { config, moviePath, cacheDir, ffmpegLog };
}

describe("embedded subtitle cache", () => {
  test("extracts once, then serves later plays from the cache (no re-extraction)", async () => {
    const { config, moviePath, cacheDir, ffmpegLog } = await setup(true);
    const signal = new AbortController().signal;

    const first = await resolveSubtitleForFile(
      config,
      moviePath,
      undefined,
      signal,
    );
    if (first === undefined) {
      throw new Error("expected a resolved subtitle on the first play");
    }
    expect(first.path.startsWith(cacheDir)).toBe(true);
    expect(first.path.endsWith(".srt")).toBe(true);
    // A persistent cache entry is shared across plays → no cleanupPath (the streamer must not unlink it).
    expect(first.cleanupPath).toBeUndefined();
    expect(await Bun.file(first.path).exists()).toBe(true);
    expect(await callCount(ffmpegLog)).toBe(1);

    const second = await resolveSubtitleForFile(
      config,
      moviePath,
      undefined,
      signal,
    );
    if (second === undefined) {
      throw new Error("expected a resolved subtitle on the second play");
    }
    expect(second.path).toBe(first.path);
    expect(second.cleanupPath).toBeUndefined();
    // The cache hit served it — ffmpeg must NOT have run a second time.
    expect(await callCount(ffmpegLog)).toBe(1);
  });

  test("re-extracts when the source file changes (size/mtime invalidates the key)", async () => {
    const { config, moviePath, ffmpegLog } = await setup(true);
    const signal = new AbortController().signal;

    await resolveSubtitleForFile(config, moviePath, undefined, signal);
    expect(await callCount(ffmpegLog)).toBe(1);

    // Replace the file with different content (different size) → a different cache key → re-extraction.
    await writeFile(
      moviePath,
      "a completely different and longer set of bytes",
    );
    const reExtracted = await resolveSubtitleForFile(
      config,
      moviePath,
      undefined,
      signal,
    );
    if (reExtracted === undefined) {
      throw new Error("expected a resolved subtitle after the file changed");
    }
    expect(reExtracted.cleanupPath).toBeUndefined();
    expect(await callCount(ffmpegLog)).toBe(2);
  });

  test("without a cache dir, extracts to a temp file that gets cleaned up", async () => {
    const { config, moviePath, cacheDir } = await setup(false);
    const signal = new AbortController().signal;

    const resolved = await resolveSubtitleForFile(
      config,
      moviePath,
      undefined,
      signal,
    );
    if (resolved === undefined) {
      throw new Error("expected a resolved subtitle");
    }
    // Uncached extraction → one-shot temp file the streamer unlinks (cleanupPath === path).
    expect(resolved.cleanupPath).toBe(resolved.path);
    expect(resolved.path.startsWith(cacheDir)).toBe(false);
    expect(await Bun.file(resolved.path).exists()).toBe(true);
  });
});
