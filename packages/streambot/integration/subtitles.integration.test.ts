import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildSoftwareVideoGraph,
  buildVaapiVideoGraph,
} from "@shepherdjerred/discord-video-stream";
import {
  resolveSubtitleForFile,
  sweepSubtitleTempDir,
} from "@shepherdjerred/streambot/sources/subtitle-io.ts";
import { probeMedia } from "@shepherdjerred/streambot/sources/probe.ts";
import { cleanRollingSrt } from "@shepherdjerred/streambot/sources/subtitle-clean.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";

/**
 * Real-ffmpeg integration tests. These run ONLY via `bun run test:integration` (and the
 * `testStreambotMedia` Dagger target, which runs them inside the streambot image where ffmpeg/ffprobe
 * + libass + zimg + fonts are guaranteed). They are NOT part of the plain `bun test` (scoped to
 * `test/`), which runs in a container without ffmpeg. They hard-fail (never skip) if a binary is
 * missing.
 */

const config = loadConfig({
  BOT_TOKEN: "bot-token",
  USER_TOKENS: "user-token",
  VIDEOS_DIR: "/tmp/videos",
});

const NEVER_ABORT = new AbortController().signal;
const CUE = "HELLO SUBTITLE WORLD";
const SRT = `1\n00:00:00,000 --> 00:00:03,000\n${CUE}\n`;
const FORCED_CUE = "FORCED ONLY LINE";
const FORCED_SRT = `1\n00:00:00,000 --> 00:00:03,000\n${FORCED_CUE}\n`;
/** A cue that exists only AFTER the seek target — for the -ss PTS-compensation regression. */
const LATE_SRT = "1\n00:00:04,000 --> 00:00:06,000\nLATE CUE\n";

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

/** Render exactly one frame of `input` at input-seek `ss` through a -vf chain, to a PNG. */
async function grabFrame(
  input: string,
  filters: readonly string[],
  out: string,
  ss?: number,
): Promise<Buffer> {
  await run([
    config.ffmpegPath,
    "-y",
    ...(ss === undefined ? [] : ["-ss", String(ss)]),
    "-i",
    input,
    "-vf",
    filters.join(","),
    "-frames:v",
    "1",
    out,
  ]);
  return readFile(out);
}

let dir: string;
/** A clip carrying ONLY an embedded subrip subtitle track (no sidecar). */
let embeddedClip: string;
/** A clip with a sibling sidecar `.en.srt` (and no embedded subtitle stream). */
let sidecarClip: string;
/** A clip with no subtitles at all. */
let plainClip: string;
/**
 * The Endgame shape: a 4K-remux-style clip whose FULL English subs are embedded (subrip) while the
 * only sidecar is `.en.forced.srt`. The forced sidecar must NOT win by source priority.
 */
let endgameClip: string;
/** An 8s clip whose embedded cue spans 4–6s — for seek-compensation tests. */
let lateCueClip: string;
/** An SDR clip flagged as HDR (PQ/BT.2020) — exercises probe + the software tonemap chain. */
let hdrClip: string;

function lavfi(duration: number): string[] {
  return [
    "-f",
    "lavfi",
    "-i",
    `testsrc=duration=${String(duration)}:size=320x240:rate=10`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${String(duration)}`,
  ];
}

const X264 = ["-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac"];

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "streambot-itest-"));
  const srtPath = path.join(dir, "cue.srt");
  await writeFile(srtPath, SRT, "utf8");

  embeddedClip = path.join(dir, "Embedded Movie (2021) Remux-1080p.mkv");
  sidecarClip = path.join(dir, "Sidecar Movie (2021) Remux-1080p.mkv");
  plainClip = path.join(dir, "Plain Movie (2021) Remux-1080p.mkv");
  endgameClip = path.join(dir, "Endgame Movie (2019) Remux-2160p.mkv");
  lateCueClip = path.join(dir, "Late Cue Movie (2021) Remux-1080p.mkv");
  hdrClip = path.join(dir, "HDR Movie (2021) Remux-2160p.mkv");

  // Embedded: mux the SRT in as a subrip subtitle stream tagged English.
  await run([
    config.ffmpegPath,
    "-y",
    ...lavfi(3),
    "-i",
    srtPath,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-map",
    "2:s",
    ...X264,
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
    ...lavfi(3),
    "-map",
    "0:v",
    "-map",
    "1:a",
    ...X264,
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
    ...lavfi(3),
    "-map",
    "0:v",
    "-map",
    "1:a",
    ...X264,
    plainClip,
  ]);

  // Endgame shape: full English subs embedded; forced-only sidecar next to the file.
  await run([
    config.ffmpegPath,
    "-y",
    ...lavfi(3),
    "-i",
    srtPath,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-map",
    "2:s",
    ...X264,
    "-c:s",
    "srt",
    "-metadata:s:s:0",
    "language=eng",
    endgameClip,
  ]);
  await writeFile(
    path.join(dir, "Endgame Movie (2019) Remux-2160p.en.forced.srt"),
    FORCED_SRT,
    "utf8",
  );

  // Late cue: 8s video, embedded cue only at 4–6s (seek-compensation regression fixture).
  const lateSrtPath = path.join(dir, "late.srt");
  await writeFile(lateSrtPath, LATE_SRT, "utf8");
  await run([
    config.ffmpegPath,
    "-y",
    ...lavfi(8),
    "-i",
    lateSrtPath,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-map",
    "2:s",
    ...X264,
    "-c:s",
    "srt",
    "-metadata:s:s:0",
    "language=eng",
    lateCueClip,
  ]);

  // HDR: flag the stream/frames as PQ + BT.2020 (8-bit is fine — the tonemap chain and the probe
  // both key off the color metadata, not the bit depth).
  await run([
    config.ffmpegPath,
    "-y",
    ...lavfi(3),
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-vf",
    "setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc",
    ...X264,
    "-color_primaries",
    "bt2020",
    "-color_trc",
    "smpte2084",
    "-colorspace",
    "bt2020nc",
    hdrClip,
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

  test("full embedded track beats a forced-only sidecar (Endgame regression)", async () => {
    const resolved = await resolveSubtitleForFile(
      config,
      endgameClip,
      undefined,
      NEVER_ABORT,
    );
    expect(resolved).toBeDefined();
    if (resolved === undefined) throw new Error("expected a subtitle");
    const text = await readFile(resolved.path, "utf8");
    expect(text).toContain(CUE);
    expect(text).not.toContain(FORCED_CUE);
  });

  test("sublang:en.forced still pins the forced sidecar", async () => {
    const resolved = await resolveSubtitleForFile(
      config,
      endgameClip,
      { language: "en.forced" },
      NEVER_ABORT,
    );
    expect(resolved).toBeDefined();
    if (resolved === undefined) throw new Error("expected a subtitle");
    const text = await readFile(resolved.path, "utf8");
    expect(text).toContain(FORCED_CUE);
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

describe("probeMedia HDR detection (real ffprobe)", () => {
  test("flags PQ/BT.2020 content as HDR", async () => {
    const info = await probeMedia(config, hdrClip, NEVER_ABORT);
    expect(info?.hdr).toBe(true);
  });

  test("plain SDR content is not flagged", async () => {
    const info = await probeMedia(config, plainClip, NEVER_ABORT);
    expect(info?.hdr).toBe(false);
  });
});

describe("software video graph (real ffmpeg)", () => {
  test("subtitle burn renders a frame and visibly changes pixels", async () => {
    const resolved = await resolveSubtitleForFile(
      config,
      sidecarClip,
      undefined,
      NEVER_ABORT,
    );
    if (resolved === undefined) throw new Error("expected a subtitle");

    const graph = buildSoftwareVideoGraph({
      width: 320,
      height: 240,
      inputColor: "sdr",
      subtitle: { path: resolved.path, startTime: 0 },
      encoderOutFilters: [],
    });
    if (graph.kind !== "filterChain") throw new Error("expected -vf chain");

    const withSubs = await grabFrame(
      sidecarClip,
      graph.filters,
      path.join(dir, "with-subs.png"),
      1, // inside the 0–3s cue window
    );
    const without = await grabFrame(
      sidecarClip,
      ["scale=320:240"],
      path.join(dir, "without.png"),
      1,
    );
    expect(withSubs.length).toBeGreaterThan(0);
    expect(without.length).toBeGreaterThan(0);
    // Burning text changes the frame, so the encoded PNGs must differ.
    expect(Buffer.compare(withSubs, without)).not.toBe(0);
  });

  test("seek compensation: cues after the -ss offset still render (and are missed without it)", async () => {
    const resolved = await resolveSubtitleForFile(
      config,
      lateCueClip,
      undefined,
      NEVER_ABORT,
    );
    if (resolved === undefined) throw new Error("expected a subtitle");

    // Seek to 5s — inside the 4–6s cue. Input -ss re-stamps PTS from 0, so without the setpts
    // sandwich libass looks up cues at t≈0 and renders nothing.
    const compensated = buildSoftwareVideoGraph({
      width: 320,
      height: 240,
      inputColor: "sdr",
      subtitle: { path: resolved.path, startTime: 5 },
      encoderOutFilters: [],
    });
    if (compensated.kind !== "filterChain") throw new Error("expected chain");

    const withCompensation = await grabFrame(
      lateCueClip,
      compensated.filters,
      path.join(dir, "seek-compensated.png"),
      5,
    );
    const uncompensated = await grabFrame(
      lateCueClip,
      [`scale=320:240`, `subtitles=filename=${resolved.path}`],
      path.join(dir, "seek-uncompensated.png"),
      5,
    );
    const noSubs = await grabFrame(
      lateCueClip,
      ["scale=320:240"],
      path.join(dir, "seek-nosubs.png"),
      5,
    );

    // The compensated graph renders the cue; the naive graph misses it (the pre-fix behavior).
    expect(Buffer.compare(withCompensation, noSubs)).not.toBe(0);
    expect(Buffer.compare(uncompensated, noSubs)).toBe(0);
  });

  test("HDR tonemap chain produces BT.709 yuv420p output (with subtitle burn on top)", async () => {
    const resolved = await resolveSubtitleForFile(
      config,
      sidecarClip,
      undefined,
      NEVER_ABORT,
    );
    if (resolved === undefined) throw new Error("expected a subtitle");

    const graph = buildSoftwareVideoGraph({
      width: 320,
      height: 240,
      inputColor: "hdr",
      subtitle: { path: resolved.path, startTime: 0 },
      encoderOutFilters: [],
    });
    if (graph.kind !== "filterChain") throw new Error("expected -vf chain");

    // Run the full chain (zscale linearize → tonemap hable → zscale bt709 → subtitles) against
    // real HDR-flagged frames and verify the encoded output is SDR BT.709.
    const out = path.join(dir, "tonemapped.mkv");
    await run([
      config.ffmpegPath,
      "-y",
      "-i",
      hdrClip,
      "-vf",
      graph.filters.join(","),
      "-frames:v",
      "1",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-an",
      out,
    ]);
    const probe = Bun.spawn(
      [
        config.ffprobePath,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=color_transfer,pix_fmt",
        "-of",
        "json",
        out,
      ],
      { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
    );
    const stdout = await new Response(probe.stdout).text();
    expect(await probe.exited).toBe(0);
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toMatchObject({
      streams: [{ color_transfer: "bt709", pix_fmt: "yuv420p" }],
    });
  });
});

describe("VAAPI graph canvas branch (real ffmpeg, GPU stages swapped for software)", () => {
  test("the alpha canvas + libass + overlay composition renders the cue", async () => {
    const resolved = await resolveSubtitleForFile(
      config,
      sidecarClip,
      undefined,
      NEVER_ABORT,
    );
    if (resolved === undefined) throw new Error("expected a subtitle");

    // Take the REAL VAAPI graph and swap only the GPU-bound stages for software equivalents
    // (scale_vaapi→scale, drop hwupload, overlay_vaapi→overlay). This validates everything CI can
    // validate without a GPU: the canvas branch string (color@0 + format=bgra + subtitles alpha),
    // path escaping, labels, and overlay framesync. tonemap_vaapi/overlay_vaapi themselves are
    // covered at runtime by the HW→SW retry.
    const graph = buildVaapiVideoGraph({
      width: 320,
      height: 240,
      frameRate: 10,
      inputColor: "sdr",
      subtitle: { path: resolved.path, startTime: 0 },
    });
    if (graph.kind !== "filterComplex") throw new Error("expected complex");
    const proxyGraph = graph.graph.map((chain) =>
      chain
        .replace("scale_vaapi=w=320:h=240:format=nv12", "scale=320:240")
        .replace(",hwupload[subs]", "[subs]")
        .replace("overlay_vaapi", "overlay"),
    );
    expect(proxyGraph.join(";")).not.toContain("vaapi");

    const out = path.join(dir, "overlay-proxy.png");
    await run([
      config.ffmpegPath,
      "-y",
      "-ss",
      "1",
      "-i",
      sidecarClip,
      "-filter_complex",
      proxyGraph.join(";"),
      "-map",
      `[${graph.mapLabel}]`,
      "-frames:v",
      "1",
      out,
    ]);
    const withOverlay = await readFile(out);
    const without = await grabFrame(
      sidecarClip,
      ["scale=320:240"],
      path.join(dir, "overlay-proxy-without.png"),
      1,
    );
    expect(Buffer.compare(withOverlay, without)).not.toBe(0);
  });
});

describe("rolling auto-caption cleanup (real libass)", () => {
  // A rolling YouTube auto-caption SRT (build-up → ~10 ms finalization → two-line carry-over scroll).
  const ROLLING = `1
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

  test("the collapsed single-line SRT is well-formed and renders through libass", async () => {
    // cleanRollingSrt is unit-tested for content; here we prove its SERIALIZED output (comma stamps,
    // blank-line separators, no trailing markup) is something real libass accepts and burns — a class
    // of bug the pure test can't see.
    const cleaned = cleanRollingSrt(ROLLING);
    if (cleaned === null)
      throw new Error("expected the rolling SRT to be cleaned");
    const cleanedPath = path.join(dir, "cleaned-rolling.srt");
    await writeFile(cleanedPath, cleaned, "utf8");

    const graph = buildSoftwareVideoGraph({
      width: 320,
      height: 240,
      inputColor: "sdr",
      subtitle: { path: cleanedPath, startTime: 0 },
      encoderOutFilters: [],
    });
    if (graph.kind !== "filterChain") throw new Error("expected -vf chain");

    // t=1s lands inside the cleaned "hey" cue (00:00:00,000 → 00:00:01,010).
    const withSubs = await grabFrame(
      plainClip,
      graph.filters,
      path.join(dir, "cleaned-with.png"),
      1,
    );
    const without = await grabFrame(
      plainClip,
      ["scale=320:240"],
      path.join(dir, "cleaned-without.png"),
      1,
    );
    expect(Buffer.compare(withSubs, without)).not.toBe(0);
  });
});
