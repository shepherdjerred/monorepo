import { afterEach, describe, expect, test } from "vitest";
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

/** ffprobe JSON for the default fixture: one burnable embedded English subrip track. */
const ENGLISH_SUBRIP = `{"streams":[{"codec_name":"subrip","tags":{"language":"eng"}}]}`;
/** ffprobe JSON for an anime-style MKV: one ASS track and one attached font. */
const ASS_TRACK = `{"streams":[{"codec_name":"ass","tags":{"language":"eng"}}]}`;
const FONT_ATTACHMENT = `{"streams":[{"codec_name":"ttf","tags":{"filename":"Sign.ttf","mimetype":"application/x-truetype-font"}}]}`;

async function setup(
  withCache: boolean,
  probe: { subtitles?: string; attachments?: string } = {},
): Promise<Fakes> {
  const bin = await tmpDir("subcache-bin-");
  const media = await tmpDir("subcache-media-");
  const cacheDir = await tmpDir("subcache-cache-");
  const ffmpegLog = path.join(bin, "ffmpeg.calls");
  const ffprobeLog = path.join(bin, "ffprobe.calls");

  // `-select_streams s` lists subtitle tracks; `-select_streams t` lists attachments.
  const ffprobe = await fakeBin(
    bin,
    "ffprobe",
    ffprobeLog,
    `case "$*" in *"-select_streams t"*) printf '%s' '${probe.attachments ?? "{}"}' ;; *) printf '%s' '${probe.subtitles ?? ENGLISH_SUBRIP}' ;; esac`,
  );
  // Write a minimal subtitle to the dest (the last positional arg), mimicking `-c:s srt <dest>` /
  // `-c:s copy -f ass <dest>`, and each `-dump_attachment:t:<i> <path>` font. The dest-must-end-in-
  // `.srt`/`.ass` guard mirrors real ffmpeg's muxer auto-detect: it picks the output format from the
  // trailing extension and errors on anything unknown (PR #1172 shipped `.srt.tmp` and broke every
  // cached extraction in prod). Keep this guard — it's the regression test for that class of bug.
  const ffmpeg = await fakeBin(
    bin,
    "ffmpeg",
    ffmpegLog,
    [
      `prev=""`,
      `for arg in "$@"; do case "$prev" in -dump_attachment:t:*) printf 'font' > "$arg" || exit 1 ;; esac; prev="$arg"; dest="$arg"; done`,
      `case "$dest" in *.srt|*.ass) ;; *) echo "fake-ffmpeg: dest must end in .srt or .ass, got: $dest" >&2; exit 1 ;; esac`,
      String.raw`printf '1\n00:00:01,000 --> 00:00:02,000\nhi\n' > "$dest"`,
    ].join("\n"),
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
    if (first?.kind !== "text") {
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
    if (second?.kind !== "text") {
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
    if (reExtracted?.kind !== "text") {
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
    if (resolved?.kind !== "text") {
      throw new Error("expected a resolved subtitle");
    }
    // Uncached extraction → a one-shot per-item temp directory the streamer removes.
    expect(resolved.cleanupPath).toBe(path.dirname(resolved.path));
    expect(resolved.path.endsWith(".srt")).toBe(true);
    expect(resolved.path.startsWith(cacheDir)).toBe(false);
    expect(await Bun.file(resolved.path).exists()).toBe(true);
  });
});

describe("resolveSubtitleForFile trackRef bypass (exact pick from the picker)", () => {
  test("an off trackRef returns undefined without probing ffprobe/ffmpeg", async () => {
    const { config, moviePath, ffmpegLog } = await setup(true);
    const signal = new AbortController().signal;
    const resolved = await resolveSubtitleForFile(
      config,
      moviePath,
      { trackRef: { kind: "off" } },
      signal,
    );
    expect(resolved).toBeUndefined();
    // Neither binary ran, so the call-log files were never created.
    expect(await Bun.file(ffmpegLog).exists()).toBe(false);
  });

  test("an embedded trackRef extracts that exact stream, skipping ranking", async () => {
    const { config, moviePath, cacheDir } = await setup(true);
    const signal = new AbortController().signal;
    const resolved = await resolveSubtitleForFile(
      config,
      moviePath,
      { trackRef: { kind: "embedded", subtitleIndex: 0, codec: "subrip" } },
      signal,
    );
    if (resolved?.kind !== "text") {
      throw new Error("expected a resolved subtitle");
    }
    expect(resolved.path.startsWith(cacheDir)).toBe(true);
    expect(await Bun.file(resolved.path).exists()).toBe(true);
  });

  test("a sidecar trackRef stages that exact file, skipping ranking", async () => {
    const { config, moviePath } = await setup(true);
    const signal = new AbortController().signal;
    const sidecarPath = path.join(path.dirname(moviePath), "Movie.es.srt");
    await writeFile(sidecarPath, "1\n00:00:00,000 --> 00:00:01,000\nhola\n");

    const resolved = await resolveSubtitleForFile(
      config,
      moviePath,
      { trackRef: { kind: "sidecar", file: "Movie.es.srt" } },
      signal,
    );
    if (resolved?.kind !== "text") {
      throw new Error("expected a resolved subtitle");
    }
    // Staged sidecars are always a one-shot temp copy (never the shared cache).
    expect(resolved.cleanupPath).toBe(resolved.path);
    const text = await readFile(resolved.path, "utf8");
    expect(text).toContain("hola");
  });

  test("an embedded image trackRef resolves to the input's own stream without running ffmpeg", async () => {
    const { config, moviePath, ffmpegLog } = await setup(true);
    const resolved = await resolveSubtitleForFile(
      config,
      moviePath,
      {
        trackRef: {
          kind: "embedded",
          subtitleIndex: 3,
          codec: "hdmv_pgs_subtitle",
        },
      },
      new AbortController().signal,
    );
    expect(resolved).toEqual({
      kind: "image",
      subtitleIndex: 3,
      codec: "hdmv_pgs_subtitle",
    });
    expect(await Bun.file(ffmpegLog).exists()).toBe(false);
  });
});

describe("ASS tracks keep their styling and fonts", () => {
  test("cached: extracts .ass once with its fonts, and a cache hit returns both", async () => {
    const { config, moviePath, cacheDir, ffmpegLog } = await setup(true, {
      subtitles: ASS_TRACK,
      attachments: FONT_ATTACHMENT,
    });
    const signal = new AbortController().signal;

    const first = await resolveSubtitleForFile(
      config,
      moviePath,
      undefined,
      signal,
    );
    if (first?.kind !== "text") throw new Error("expected a text subtitle");
    expect(first.path.startsWith(cacheDir)).toBe(true);
    expect(first.path.endsWith(".ass")).toBe(true);
    expect(first.cleanupPath).toBeUndefined();
    expect(first.fontsDir).toBe(first.path.replace(/\.ass$/u, ".fonts"));
    expect(
      await Bun.file(path.join(first.fontsDir ?? "", "font-0.ttf")).exists(),
    ).toBe(true);

    const second = await resolveSubtitleForFile(
      config,
      moviePath,
      undefined,
      signal,
    );
    expect(second).toEqual(first);
    expect(await callCount(ffmpegLog)).toBe(1);
  });

  test("uncached: track and fonts share one per-item temp directory that is the cleanup unit", async () => {
    const { config, moviePath, cacheDir } = await setup(false, {
      subtitles: ASS_TRACK,
      attachments: FONT_ATTACHMENT,
    });
    const resolved = await resolveSubtitleForFile(
      config,
      moviePath,
      undefined,
      new AbortController().signal,
    );
    if (resolved?.kind !== "text") throw new Error("expected a text subtitle");
    expect(resolved.path.startsWith(cacheDir)).toBe(false);
    expect(path.basename(resolved.path)).toBe("track.ass");
    expect(resolved.cleanupPath).toBe(path.dirname(resolved.path));
    expect(resolved.fontsDir).toBe(
      path.join(resolved.cleanupPath ?? "", "fonts"),
    );
    expect(
      await Bun.file(path.join(resolved.fontsDir ?? "", "font-0.ttf")).exists(),
    ).toBe(true);
  });

  test("an ASS track without font attachments burns with system fonts (no fontsDir)", async () => {
    const { config, moviePath } = await setup(true, { subtitles: ASS_TRACK });
    const resolved = await resolveSubtitleForFile(
      config,
      moviePath,
      undefined,
      new AbortController().signal,
    );
    if (resolved?.kind !== "text") throw new Error("expected a text subtitle");
    expect(resolved.path.endsWith(".ass")).toBe(true);
    expect(resolved.fontsDir).toBeUndefined();
  });
});

describe("automatic selection never burns a foreign-language track", () => {
  const FRENCH_ONLY = `{"streams":[{"codec_name":"subrip","tags":{"language":"fre"}}]}`;

  test("a file whose only track is foreign plays without subtitles", async () => {
    const { config, moviePath, ffmpegLog } = await setup(true, {
      subtitles: FRENCH_ONLY,
    });
    const resolved = await resolveSubtitleForFile(
      config,
      moviePath,
      undefined,
      new AbortController().signal,
    );
    expect(resolved).toBeUndefined();
    expect(await Bun.file(ffmpegLog).exists()).toBe(false);
  });

  test("an explicit pick of that foreign track still burns it", async () => {
    const { config, moviePath } = await setup(true, {
      subtitles: FRENCH_ONLY,
    });
    const resolved = await resolveSubtitleForFile(
      config,
      moviePath,
      { trackRef: { kind: "embedded", subtitleIndex: 0, codec: "subrip" } },
      new AbortController().signal,
    );
    expect(resolved?.kind).toBe("text");
  });

  test("a sublang request for that language burns it", async () => {
    const { config, moviePath } = await setup(true, {
      subtitles: FRENCH_ONLY,
    });
    const resolved = await resolveSubtitleForFile(
      config,
      moviePath,
      { language: "fr" },
      new AbortController().signal,
    );
    expect(resolved?.kind).toBe("text");
  });

  test("an untagged (und) track is still auto-burned", async () => {
    const { config, moviePath } = await setup(true, {
      subtitles: `{"streams":[{"codec_name":"subrip","tags":{"language":"und"}}]}`,
    });
    const resolved = await resolveSubtitleForFile(
      config,
      moviePath,
      undefined,
      new AbortController().signal,
    );
    expect(resolved?.kind).toBe("text");
  });

  test("an English PGS track is preferred over a foreign text track", async () => {
    const { config, moviePath, ffmpegLog } = await setup(true, {
      subtitles: `{"streams":[{"codec_name":"subrip","tags":{"language":"ita"},"disposition":{"forced":1}},{"codec_name":"hdmv_pgs_subtitle","tags":{"language":"eng"}}]}`,
    });
    const resolved = await resolveSubtitleForFile(
      config,
      moviePath,
      undefined,
      new AbortController().signal,
    );
    expect(resolved).toEqual({
      kind: "image",
      subtitleIndex: 1,
      codec: "hdmv_pgs_subtitle",
    });
    expect(await Bun.file(ffmpegLog).exists()).toBe(false);
  });
});
