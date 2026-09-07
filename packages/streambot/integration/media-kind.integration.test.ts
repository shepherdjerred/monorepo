import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probeMedia } from "@shepherdjerred/streambot/sources/probe.ts";
import { resolveSource } from "@shepherdjerred/streambot/sources/resolve.ts";
import { httpHeaderInputOptions } from "@shepherdjerred/streambot/sources/format-select.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";

/**
 * Real-ffmpeg/ffprobe integration tests for the music-vs-video decision, run ONLY via
 * `bun run test:integration`. They hard-fail (never skip) if a binary is missing, and they never
 * touch the network — see the local-server note below.
 *
 * These exist because a mutation audit found two behaviors that NO unit test could catch, both in
 * the same place: the wiring of the classifier into `resolveSource`. Every pure function was
 * covered; deleting the calls that USE them failed nothing. `resolveSource` reaches ffprobe through
 * a direct import, and this package deliberately has no mocking anywhere in `test/`, so the honest
 * way to cover the wiring is to run it for real against real media.
 */

const config = loadConfig({
  BOT_TOKEN: "bot-token",
  USER_TOKENS: "user-token",
  VIDEOS_DIR: "/tmp/videos",
});

const NEVER_ABORT = new AbortController().signal;

/** A pre-resolution that CLAIMS to be video, whatever `input` actually turns out to contain. */
function videoTypedButAudioOnly(input: string): ResolvedSource {
  return {
    title: "Mislabelled",
    ffmpegInput: input,
    mediaKind: "video",
    audioInput: "https://cdn.invalid/second-input",
    audioInputHeaders: { "User-Agent": "Mozilla/5.0" },
    ffmpegInputHeaders: { "User-Agent": "Mozilla/5.0" },
    chapters: [],
  };
}

/** Header the fake CDN below demands, standing in for yt-dlp's signed `http_headers`. */
const REQUIRED_HEADER = "X-Streambot-Signature";
const REQUIRED_VALUE = "valid-signature";

let dir: string;
/** An audio-only file: ffprobe reports `videoCodec: "unknown"` for it, which is rule 1's trigger. */
let audioOnlyPath: string;
/** A normal video file, as the control. */
let videoPath: string;

/**
 * A local `Bun.serve` standing in for a signed CDN: it answers 403 unless the exact header is
 * present. Deliberately local rather than a real archive.org/YouTube URL — a networked test in a
 * required CI gate fails for reasons unrelated to the code, and people learn to re-run it rather
 * than read it.
 */
let server: ReturnType<typeof Bun.serve> | undefined;
/** Signed URL serving the video file. */
let signedVideoUrl: string;
/** Signed URL serving the audio-only file. */
let signedAudioUrl: string;

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

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "streambot-media-kind-"));
  audioOnlyPath = path.join(dir, "song.m4a");
  videoPath = path.join(dir, "clip.mp4");
  await run([
    config.ffmpegPath,
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    "-c:a",
    "aac",
    audioOnlyPath,
  ]);
  await run([
    config.ffmpegPath,
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=15:duration=3",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    videoPath,
  ]);

  const videoBody = await readFile(videoPath);
  const audioBody = await readFile(audioOnlyPath);
  server = Bun.serve({
    port: 0,
    fetch(request) {
      if (request.headers.get(REQUIRED_HEADER) !== REQUIRED_VALUE) {
        return new Response("forbidden", { status: 403 });
      }
      const isAudio = new URL(request.url).pathname.endsWith(".m4a");
      const body = isAudio ? audioBody : videoBody;
      return new Response(body, {
        headers: {
          "Content-Type": isAudio ? "audio/mp4" : "video/mp4",
          "Content-Length": String(body.byteLength),
        },
      });
    },
  });
  signedVideoUrl = `http://127.0.0.1:${String(server.port)}/signed.mp4`;
  signedAudioUrl = `http://127.0.0.1:${String(server.port)}/signed.m4a`;
}, 120_000);

afterAll(async () => {
  await server?.stop(true);
  await rm(dir, { recursive: true, force: true });
});

describe("probeMedia sends yt-dlp's signed headers to ffprobe", () => {
  /**
   * A local `Bun.serve` standing in for a signed CDN: it answers 403 unless the exact header is
   * present. Deliberately local rather than a real archive.org/YouTube URL — a networked test in a
   * required CI gate fails for reasons unrelated to the code, and people learn to re-run it rather
   * than read it.
   *
   * What this protects is subtle and worth stating: `resolveSource` uses the ffprobe of the FINAL
   * chosen input as the authoritative "does this have a picture" check, which is what stops an
   * audio-only source with `mode: "video"` from reaching the fork's `attachPipeline` hard-throw.
   * A signed URL that 403s makes `probeMedia` return `null`, and `null` means "no evidence", so the
   * guard silently stops guarding while still looking present. That is worse than not having it.
   */
  test("the fake CDN really does reject an unsigned request", async () => {
    // Asserted directly so a later failure cannot be blamed on a server that accepts everything —
    // without this, the two tests below could both pass against a broken fixture.
    const rejected = await fetch(signedVideoUrl);
    expect(rejected.status).toBe(403);
    const accepted = await fetch(signedVideoUrl, {
      headers: { [REQUIRED_HEADER]: REQUIRED_VALUE },
    });
    expect(accepted.status).toBe(200);
  });

  test("without headers the probe fails — the silently-disarmed-guard case", async () => {
    expect(await probeMedia(config, signedVideoUrl, NEVER_ABORT)).toBeNull();
  });

  test("with the headers threaded through, ffprobe reads the stream", async () => {
    const info = await probeMedia(config, signedVideoUrl, NEVER_ABORT, {
      [REQUIRED_HEADER]: REQUIRED_VALUE,
    });
    expect(info).not.toBeNull();
    expect(info?.videoCodec).toBe("h264");
    expect(info?.height).toBe(240);
  });

  test("the argument rendering ffprobe consumed is the one shipped to ffmpeg", () => {
    // `probeMedia` and the video pipeline render headers with the SAME function, so the test above
    // is evidence for both. Pinning the exact string keeps that shared contract visible.
    expect(
      httpHeaderInputOptions({ [REQUIRED_HEADER]: REQUIRED_VALUE }),
    ).toEqual(["-headers", `${REQUIRED_HEADER}: ${REQUIRED_VALUE}`]);
  });
});

describe("resolveSource wires the classifier to the real probe", () => {
  test("an audio-only local file requested as mode: video resolves to music", async () => {
    // The file branch probes before it classifies, so rule 1 fires during classification here.
    // `mode: "video"` is honoured everywhere EXCEPT this case, because the fork's `attachPipeline`
    // hard-throws "No video stream in media" on a video-typed play with no video track — after
    // ffmpeg has spawned and Go Live is open. Obeying the user into a guaranteed crash is worse
    // than overriding them.
    const resolved = await resolveSource(
      config,
      {
        kind: "file",
        path: audioOnlyPath,
        title: "A Song",
        mode: "video",
      },
      NEVER_ABORT,
    );
    expect(resolved.mediaKind).toBe("music");
    expect(resolved.ffmpegInput).toBe(audioOnlyPath);
    // Threaded from the same probe. Also the assertion that fails if the probe result stops being
    // folded into the result at all.
    expect(resolved.durationSeconds).toBeGreaterThan(2);
  }, 60_000);

  test("a real video file requested as mode: video stays video", async () => {
    const resolved = await resolveSource(
      config,
      { kind: "file", path: videoPath, title: "A Clip", mode: "video" },
      NEVER_ABORT,
    );
    expect(resolved.mediaKind).toBe("video");
  }, 60_000);

  test("a video file with no mode stays video (the library default)", async () => {
    const resolved = await resolveSource(
      config,
      { kind: "file", path: videoPath, title: "A Clip" },
      NEVER_ABORT,
    );
    expect(resolved.mediaKind).toBe("video");
  }, 60_000);

  test("an audio-only file with no mode resolves to music", async () => {
    const resolved = await resolveSource(
      config,
      { kind: "file", path: audioOnlyPath, title: "A Song" },
      NEVER_ABORT,
    );
    expect(resolved.mediaKind).toBe("music");
  }, 60_000);
});

describe("resolveSource re-checks a pre-resolved item against its real input", () => {
  /**
   * The path that actually exercises `finalizeResolved`'s downgrade, and the reason the obvious
   * local-file test above is NOT sufficient on its own: the file branch probes before it
   * classifies, so it never produces a video-typed result that needs correcting.
   *
   * `preResolved` does. It carries a result yt-dlp produced during `/stream play`'s synchronous
   * pre-validation, and `resolveSource` trusts its kind but still probes the input it names. A
   * video-typed pre-resolution whose input turns out to have no picture is exactly the shape rule 1
   * exists to catch, and here it is caught by the probe rather than by metadata.
   */
  test("downgrades to music and drops the second input", async () => {
    const resolved = await resolveSource(
      config,
      { kind: "url", url: "https://example.invalid/mislabelled" },
      NEVER_ABORT,
      videoTypedButAudioOnly(audioOnlyPath),
    );
    expect(resolved.mediaKind).toBe("music");
    // The second input MUST go with it: the music pipeline runs one input with `-vn`, so a
    // surviving `audioInput` would have `prepareStream` emit `-map 1:a:0` against an input the
    // audio path never opens.
    expect(resolved.audioInput).toBeUndefined();
    expect(resolved.audioInputHeaders).toBeUndefined();
    // The primary input and its headers survive — that is the stream about to play.
    expect(resolved.ffmpegInput).toBe(audioOnlyPath);
    expect(resolved.ffmpegInputHeaders).toEqual({
      "User-Agent": "Mozilla/5.0",
    });
  }, 60_000);

  test("carries the signed headers into the probe, or the guard silently disarms", async () => {
    // The end-to-end version of the 403 case, and the one that fails if `resolveSource` stops
    // passing `ffmpegInputHeaders` down: this input is a SIGNED url whose content is audio-only.
    //
    // With the headers, ffprobe reads it, sees no video, and rule 1 downgrades to music. Without
    // them the CDN answers 403, `probeMedia` returns `null`, `null` means "no evidence", and the
    // item stays typed as video — straight into the fork's hard throw. Both paths look identical
    // from outside; only the resulting `mediaKind` tells them apart, which is why this assertion
    // has to exist at THIS level and not just on `probeMedia`.
    const resolved = await resolveSource(
      config,
      { kind: "url", url: "https://example.invalid/signed" },
      NEVER_ABORT,
      {
        title: "Signed But Audio Only",
        ffmpegInput: signedAudioUrl,
        mediaKind: "video",
        ffmpegInputHeaders: { [REQUIRED_HEADER]: REQUIRED_VALUE },
        chapters: [],
      },
    );
    expect(resolved.mediaKind).toBe("music");
  }, 60_000);

  test("a signed video url stays video and picks up its probed duration", async () => {
    const resolved = await resolveSource(
      config,
      { kind: "url", url: "https://example.invalid/signed-video" },
      NEVER_ABORT,
      {
        title: "Signed Video",
        ffmpegInput: signedVideoUrl,
        mediaKind: "video",
        ffmpegInputHeaders: { [REQUIRED_HEADER]: REQUIRED_VALUE },
        chapters: [],
      },
    );
    expect(resolved.mediaKind).toBe("video");
    // Only a probe that actually fetched the stream can produce this.
    expect(resolved.durationSeconds).toBeGreaterThan(2);
  }, 60_000);

  test("leaves a correctly video-typed pre-resolution alone, second input and all", async () => {
    const resolved = await resolveSource(
      config,
      { kind: "url", url: "https://example.invalid/fine" },
      NEVER_ABORT,
      videoTypedButAudioOnly(videoPath),
    );
    expect(resolved.mediaKind).toBe("video");
    expect(resolved.audioInput).toBe("https://cdn.invalid/second-input");
    expect(resolved.audioInputHeaders).toEqual({ "User-Agent": "Mozilla/5.0" });
  }, 60_000);
});
