import {
  loadIntegrationConfig,
  NEVER_ABORT,
  runCommand,
} from "./run-command.ts";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildSoftwareVideoGraph,
  buildVaapiVideoGraph,
} from "@shepherdjerred/discord-video-stream";
import { resolveSubtitleForFile } from "@shepherdjerred/streambot/sources/subtitle-io.ts";
import { sweepSubtitleTempDir } from "@shepherdjerred/streambot/sources/subtitle-process.ts";
import { probeMedia } from "@shepherdjerred/streambot/sources/probe.ts";
import { cleanRollingSrt } from "@shepherdjerred/streambot/sources/subtitle-clean.ts";
import { writePgsSup } from "./pgs-fixture.ts";

/**
 * Real-ffmpeg integration tests. These run ONLY via `bun run test:integration` — run it where
 * ffmpeg/ffprobe + libass + zimg + fonts are available (e.g. inside the streambot image, where the
 * image smoke runs them). They are NOT part of the plain `bun run test`
 * (scoped to `test/`). They hard-fail (never skip) if a binary is missing.
 */

const config = loadIntegrationConfig();
const CUE = "HELLO SUBTITLE WORLD";
const SRT = `1\n00:00:00,000 --> 00:00:03,000\n${CUE}\n`;
const FORCED_CUE = "FORCED ONLY LINE";
const FORCED_SRT = `1\n00:00:00,000 --> 00:00:03,000\n${FORCED_CUE}\n`;
/** A cue that exists only AFTER the seek target — for the -ss PTS-compensation regression. */
const LATE_SRT = "1\n00:00:04,000 --> 00:00:06,000\nLATE CUE\n";

async function runWithin(cmd: string[], timeoutMs: number): Promise<void> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  try {
    const [stderr, code] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (timedOut) {
      throw new Error(
        `command exceeded ${String(timeoutMs)}ms: ${cmd.join(" ")}`,
      );
    }
    if (code !== 0) {
      throw new Error(
        `command failed (${String(code)}): ${cmd.join(" ")}\n${stderr.trim().slice(-800)}`,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** Render exactly one frame of `input` at input-seek `ss` through a -vf chain, to a PNG. */
async function grabFrame(
  input: string,
  filters: readonly string[],
  out: string,
  ss?: number,
): Promise<Buffer> {
  await runCommand([
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
  await runCommand([
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
  await runCommand([
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
  await runCommand([
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
  await runCommand([
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
  await runCommand([
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
  await runCommand([
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
  // Generous hook timeout: this builds six clips with sequential real-ffmpeg
  // encodes. They finish in ~1-2s idle, but bun's default 5s hook timeout is
  // easily blown when the CI node is CPU-contended (the runner then SIGTERMs
  // the in-flight ffmpeg — exit 143 — and the suite flakes).
}, 120_000);

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
    if (resolved?.kind !== "text") throw new Error("expected a text subtitle");
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
    if (resolved?.kind !== "text") throw new Error("expected a text subtitle");
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
    if (resolved?.kind !== "text") throw new Error("expected a text subtitle");
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
    if (resolved?.kind !== "text") throw new Error("expected a text subtitle");
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
    if (resolved?.kind !== "text") throw new Error("expected a text subtitle");

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
    if (resolved?.kind !== "text") throw new Error("expected a text subtitle");

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
    if (resolved?.kind !== "text") throw new Error("expected a text subtitle");

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
    await runCommand([
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

// Run the production VAAPI graph's canvas, subtitle and framesync behavior in
// software by swapping only the GPU stages. The hardware filters themselves
// are covered at runtime by the hardware-to-software retry.
async function softwareVaapiSubtitleGraph() {
  const resolved = await resolveSubtitleForFile(
    config,
    sidecarClip,
    undefined,
    NEVER_ABORT,
  );
  if (resolved?.kind !== "text") throw new Error("expected a text subtitle");

  const graph = buildVaapiVideoGraph({
    width: 320,
    height: 240,
    frameRate: 10,
    inputColor: "sdr",
    subtitle: { path: resolved.path, startTime: 0 },
  });
  if (graph.kind !== "filterComplex") throw new Error("expected complex");
  const proxy = graph.graph.map((chain) =>
    chain
      .replace("scale_vaapi=w=320:h=240:format=nv12", "scale=320:240")
      .replace(",hwupload[subs]", "[subs]")
      .replace("overlay_vaapi", "overlay"),
  );
  return { filters: proxy.join(";"), map: `[${graph.mapLabel}]` };
}

describe("VAAPI graph canvas branch (real ffmpeg, GPU stages swapped for software)", () => {
  test("the alpha canvas + libass + overlay composition renders the cue", async () => {
    const { filters, map } = await softwareVaapiSubtitleGraph();
    expect(filters).not.toContain("vaapi");

    const out = path.join(dir, "overlay-proxy.png");
    await runCommand([
      config.ffmpegPath,
      "-y",
      "-ss",
      "1",
      "-i",
      sidecarClip,
      "-filter_complex",
      filters,
      "-map",
      map,
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

  test("the subtitle canvas terminates when the primary video reaches EOF", async () => {
    const { filters, map } = await softwareVaapiSubtitleGraph();
    expect(filters).toContain("overlay=shortest=1");

    // No -frames:v or -t guard: ffmpeg must terminate because the three-second primary input
    // ended. Without shortest=1, the color source is infinite and this command hits the timeout.
    await runWithin(
      [
        config.ffmpegPath,
        "-y",
        "-i",
        sidecarClip,
        "-filter_complex",
        filters,
        "-map",
        map,
        "-f",
        "null",
        "-",
      ],
      10_000,
    );
  });
});

/** Input `-ss` (the streamer's seek) and output `-ss` (which frame after it to keep), in seconds. */
type FrameTiming = { ss?: number; at: number };

/**
 * One 320x240 frame of `input` as raw 8-bit luma, through a `-filter_complex` graph or (without
 * one) a plain scale. Raw luma rather than PNG: an overlay of a fully transparent subtitle frame
 * still re-rounds chroma, so "no cue" has to be judged on pixel values, not on identical bytes.
 */
async function grabLuma(
  input: string,
  complex: {
    readonly graph: readonly string[];
    readonly mapLabel: string;
  } | null,
  out: string,
  timing: FrameTiming,
): Promise<Buffer> {
  await runCommand([
    config.ffmpegPath,
    "-y",
    ...(timing.ss === undefined ? [] : ["-ss", String(timing.ss)]),
    "-i",
    input,
    ...(complex === null
      ? ["-vf", "scale=320:240"]
      : [
          "-filter_complex",
          complex.graph.join(";"),
          "-map",
          `[${complex.mapLabel}]`,
        ]),
    "-ss",
    String(timing.at),
    "-frames:v",
    "1",
    "-pix_fmt",
    "gray",
    "-f",
    "rawvideo",
    out,
  ]);
  return readFile(out);
}

/** The PGS fixture's cue box (an opaque white bar), in the 320x240 output. */
const CUE_BOX = { x: 40, y: 190, width: 240, height: 30 };

/** Mean absolute luma difference between two raw 320x240 frames inside {@link CUE_BOX}. */
function cueLumaDelta(a: Buffer, b: Buffer): number {
  let sum = 0;
  for (let y = CUE_BOX.y; y < CUE_BOX.y + CUE_BOX.height; y++) {
    for (let x = CUE_BOX.x; x < CUE_BOX.x + CUE_BOX.width; x++) {
      const i = y * 320 + x;
      sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    }
  }
  return sum / (CUE_BOX.width * CUE_BOX.height);
}

/** Luma change a burn makes inside the cue box versus the same frame without subtitles. */
async function cueDelta(
  input: string,
  complex: { readonly graph: readonly string[]; readonly mapLabel: string },
  name: string,
  timing: FrameTiming,
): Promise<number> {
  const burned = await grabLuma(
    input,
    complex,
    path.join(dir, `${name}.gray`),
    timing,
  );
  const plain = await grabLuma(
    input,
    null,
    path.join(dir, `${name}-plain.gray`),
    timing,
  );
  expect(burned).toHaveLength(320 * 240);
  return cueLumaDelta(burned, plain);
}

/** A visible cue moves the box's luma by tens of levels; an empty overlay by rounding only. */
const CUE_SHOWN = 40;
const CUE_HIDDEN = 4;

/** Render one frame of `input` through a `-filter_complex` graph (output-seeked to `at`), to a PNG. */
async function grabComplexFrame(
  input: string,
  complex: { readonly graph: readonly string[]; readonly mapLabel: string },
  out: string,
  timing: FrameTiming,
): Promise<Buffer> {
  await runCommand([
    config.ffmpegPath,
    "-y",
    ...(timing.ss === undefined ? [] : ["-ss", String(timing.ss)]),
    "-i",
    input,
    "-filter_complex",
    complex.graph.join(";"),
    "-map",
    `[${complex.mapLabel}]`,
    "-ss",
    String(timing.at),
    "-frames:v",
    "1",
    out,
  ]);
  return readFile(out);
}

/** Swap the VAAPI graph's GPU-only stages for software equivalents (CI has no GPU). */
function vaapiProxy(graph: readonly string[]): string[] {
  return graph.map((chain) =>
    chain
      .replace("scale_vaapi=w=320:h=240:format=nv12", "scale=320:240")
      .replace(",hwupload[subs]", "[subs]")
      .replace("overlay_vaapi", "overlay"),
  );
}

describe("image subtitles (PGS) are overlaid from the input stream (real ffmpeg)", () => {
  /**
   * 8s clip, subtitle track 0 = a forced Italian subrip, track 1 = an English PGS track whose cues
   * are opaque white bars at 1–3s and 5–7s. The English-only-as-PGS shape of a Blu-ray remux.
   */
  let pgsClip: string;

  beforeAll(async () => {
    pgsClip = path.join(dir, "PGS Movie (2021) Remux-1080p.mkv");
    const sup = path.join(dir, "pgs.sup");
    await writePgsSup(sup, { width: 320, height: 240 }, [
      { start: 1, end: 3, x: 40, y: 190, width: 240, height: 30 },
      { start: 5, end: 7, x: 40, y: 190, width: 240, height: 30 },
    ]);
    const italian = path.join(dir, "ita.srt");
    await writeFile(italian, SRT, "utf8");
    await runCommand([
      config.ffmpegPath,
      "-y",
      ...lavfi(8),
      "-i",
      italian,
      "-i",
      sup,
      // Keep the PGS cue times as authored (ffmpeg otherwise rebases each input to start at 0).
      "-copyts",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-map",
      "2:s",
      "-map",
      "3:s",
      ...X264,
      "-c:s",
      "copy",
      "-metadata:s:s:0",
      "language=ita",
      "-disposition:s:0",
      "forced",
      "-metadata:s:s:1",
      "language=eng",
      pgsClip,
    ]);
  }, 60_000);

  test("the English PGS track is selected over the foreign text track and is not extracted", async () => {
    const resolved = await resolveSubtitleForFile(
      config,
      pgsClip,
      undefined,
      NEVER_ABORT,
    );
    expect(resolved).toEqual({
      kind: "image",
      subtitleIndex: 1,
      codec: "hdmv_pgs_subtitle",
    });
  });

  test("software graph: the cue is burned while on screen and absent between cues", async () => {
    const graph = buildSoftwareVideoGraph({
      width: 320,
      height: 240,
      inputColor: "sdr",
      subtitle: { kind: "image", streamIndex: 1 },
      encoderOutFilters: [],
    });
    if (graph.kind !== "filterComplex") throw new Error("expected complex");
    expect(
      await cueDelta(pgsClip, graph, "pgs-during", { at: 2 }),
    ).toBeGreaterThan(CUE_SHOWN);
    expect(
      await cueDelta(pgsClip, graph, "pgs-between", { at: 4 }),
    ).toBeLessThan(CUE_HIDDEN);
    expect(
      await cueDelta(pgsClip, graph, "pgs-after-last", { at: 7.5 }),
    ).toBeLessThan(CUE_HIDDEN);
  });

  test("seek: an input -ss keeps the subtitle stream in sync with the picture (no PTS compensation)", async () => {
    const graph = buildSoftwareVideoGraph({
      width: 320,
      height: 240,
      inputColor: "sdr",
      subtitle: { kind: "image", streamIndex: 1 },
      encoderOutFilters: [],
    });
    if (graph.kind !== "filterComplex") throw new Error("expected complex");
    // Seek to 4s; 1.5s later the media clock is 5.5s — inside the second cue.
    expect(
      await cueDelta(pgsClip, graph, "pgs-seek-in-cue", { ss: 4, at: 1.5 }),
    ).toBeGreaterThan(CUE_SHOWN);
    // 0.5s after the seek the media clock is 4.5s — between cues, so nothing may show early.
    expect(
      await cueDelta(pgsClip, graph, "pgs-seek-before-cue", { ss: 4, at: 0.5 }),
    ).toBeLessThan(CUE_HIDDEN);
    // 2.5s after the seek the media clock is 6.5s; 3.5s after, 7.5s (the cue cleared at 7s).
    expect(
      await cueDelta(pgsClip, graph, "pgs-seek-late-cue", { ss: 4, at: 2.5 }),
    ).toBeGreaterThan(CUE_SHOWN);
    expect(
      await cueDelta(pgsClip, graph, "pgs-seek-cleared", { ss: 4, at: 3.5 }),
    ).toBeLessThan(CUE_HIDDEN);
  });

  test("VAAPI graph (GPU stages swapped for software): burns the cue and runs to the end of the video", async () => {
    const graph = buildVaapiVideoGraph({
      width: 320,
      height: 240,
      frameRate: 10,
      inputColor: "sdr",
      subtitle: { kind: "image", streamIndex: 1 },
    });
    if (graph.kind !== "filterComplex") throw new Error("expected complex");
    const proxy = vaapiProxy(graph.graph);
    expect(proxy.join(";")).not.toContain("vaapi");
    expect(proxy.join(";")).toContain("overlay=eof_action=pass");

    const complex = { graph: proxy, mapLabel: graph.mapLabel };
    expect(
      await cueDelta(pgsClip, complex, "pgs-vaapi-proxy", { at: 6 }),
    ).toBeGreaterThan(CUE_SHOWN);
    expect(
      await cueDelta(pgsClip, complex, "pgs-vaapi-proxy-gap", { at: 4 }),
    ).toBeLessThan(CUE_HIDDEN);

    // The subtitle stream ends before the picture: every one of the 80 frames still comes out, and
    // ffmpeg terminates on its own.
    const md5 = path.join(dir, "pgs-vaapi-proxy.framemd5");
    await runWithin(
      [
        config.ffmpegPath,
        "-y",
        "-i",
        pgsClip,
        "-filter_complex",
        proxy.join(";"),
        "-map",
        `[${graph.mapLabel}]`,
        "-f",
        "framemd5",
        md5,
      ],
      20_000,
    );
    const md5Text = await readFile(md5, "utf8");
    const frames = md5Text
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(frames).toHaveLength(80);
  });
});

describe("ASS tracks keep styling and attached fonts (real ffmpeg)", () => {
  const ASS = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 320",
    "PlayResY: 240",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Sign,Attached Sign Font,24,&H000000FF,&H000000FF,&H00FFFFFF,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,7,10,10,10,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    String.raw`Dialogue: 0,0:00:00.00,0:00:03.00,Sign,,0,0,0,,{\pos(20,20)}SIGN TEXT`,
    "",
  ].join("\n");
  /** Attachment payload: the extraction must reproduce it byte for byte. */
  const FONT_BYTES = Buffer.from("not-really-a-font-but-dumped-verbatim");
  let assClip: string;

  beforeAll(async () => {
    assClip = path.join(dir, "ASS Anime (2021) Remux-1080p.mkv");
    const assPath = path.join(dir, "styled.ass");
    await writeFile(assPath, ASS, "utf8");
    const fontPath = path.join(dir, "Sign.ttf");
    await writeFile(fontPath, FONT_BYTES);
    await runCommand([
      config.ffmpegPath,
      "-y",
      ...lavfi(3),
      "-i",
      assPath,
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-map",
      "2:s",
      ...X264,
      "-c:s",
      "copy",
      "-metadata:s:s:0",
      "language=eng",
      "-attach",
      fontPath,
      "-metadata:s:t:0",
      "mimetype=application/x-truetype-font",
      assClip,
    ]);
  }, 60_000);

  test("extracts the track as .ass (styles and positioning intact) and dumps the attached font", async () => {
    const resolved = await resolveSubtitleForFile(
      config,
      assClip,
      undefined,
      NEVER_ABORT,
    );
    if (resolved?.kind !== "text") throw new Error("expected a text subtitle");
    expect(resolved.path.endsWith(".ass")).toBe(true);
    const text = await readFile(resolved.path, "utf8");
    expect(text).toContain("[V4+ Styles]");
    expect(text).toContain("Attached Sign Font");
    expect(text).toContain(String.raw`{\pos(20,20)}SIGN TEXT`);
    if (resolved.fontsDir === undefined) throw new Error("expected fonts");
    expect(
      Buffer.compare(
        await readFile(path.join(resolved.fontsDir, "font-0.ttf")),
        FONT_BYTES,
      ),
    ).toBe(0);
    // Uncached: track and fonts live in one per-item directory, removed as a unit.
    expect(resolved.cleanupPath).toBe(path.dirname(resolved.path));
  });

  test("libass burns the extracted track with fontsdir on both graph shapes", async () => {
    const resolved = await resolveSubtitleForFile(
      config,
      assClip,
      undefined,
      NEVER_ABORT,
    );
    if (resolved?.kind !== "text" || resolved.fontsDir === undefined) {
      throw new Error("expected a text subtitle with fonts");
    }
    const subtitle = {
      path: resolved.path,
      fontsDir: resolved.fontsDir,
      startTime: 1,
    };
    const software = buildSoftwareVideoGraph({
      width: 320,
      height: 240,
      inputColor: "sdr",
      subtitle,
      encoderOutFilters: [],
    });
    if (software.kind !== "filterChain") throw new Error("expected chain");
    expect(software.filters.join(",")).toContain("fontsdir=");
    const withSubs = await grabFrame(
      assClip,
      software.filters,
      path.join(dir, "ass-sw.png"),
      1,
    );
    const without = await grabFrame(
      assClip,
      ["scale=320:240"],
      path.join(dir, "ass-without.png"),
      1,
    );
    expect(Buffer.compare(withSubs, without)).not.toBe(0);

    const vaapi = buildVaapiVideoGraph({
      width: 320,
      height: 240,
      frameRate: 10,
      inputColor: "sdr",
      subtitle,
    });
    if (vaapi.kind !== "filterComplex") throw new Error("expected complex");
    const gpu = await grabComplexFrame(
      assClip,
      { graph: vaapiProxy(vaapi.graph), mapLabel: vaapi.mapLabel },
      path.join(dir, "ass-vaapi-proxy.png"),
      { ss: 1, at: 0 },
    );
    expect(Buffer.compare(gpu, without)).not.toBe(0);
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
