/**
 * Pure ffmpeg video-graph builders for the transcoding path. Everything here is deterministic
 * string assembly — no I/O, no ffmpeg — so every graph variant (software/VAAPI × SDR/HDR ×
 * subtitles/none × seek offset) is unit-testable.
 *
 * Two shapes come out of these builders:
 * - `filterChain`: a plain `-vf` chain (single video branch).
 * - `filterComplex`: a multi-branch `-filter_complex` graph whose final video is labeled
 *   `[vout]` — used by the VAAPI pipeline to burn subtitles on the GPU: libass renders onto a
 *   transparent BGRA canvas (CPU, cheap), the canvas is `hwupload`ed once per frame, and
 *   `overlay_vaapi` composites it over the scaled/tonemapped GPU surface. This keeps decode,
 *   scale, tonemap, composite, and encode on the GPU — the software `subtitles=` burn used to
 *   force the whole pipeline (4K HEVC decode + swscale + libx264) onto the CPU, which cannot
 *   hold realtime on large remuxes.
 */

export type VideoGraphSpec = {
  /** Selected input video stream, including attached pictures in FFmpeg's video index space. */
  videoStreamIndex?: number;
  /** Output width (concrete positive — GPU scale filters reject the `-2` aspect shorthand). */
  width: number;
  /** Output height (concrete positive). */
  height: number;
  /**
   * Frame rate for the subtitle canvas branch. Should match the output rate so `overlay_vaapi`'s
   * framesync doesn't duplicate/drop overlay frames; omitted → lavfi `color` default (25fps).
   * Rendered with {@link formatFrameRate}, the same spelling `-r` gets.
   */
  frameRate?: number;
  /**
   * The source is interlaced: deinterlace (one output frame per input frame) before scaling, so
   * the combing is not scaled into the picture. `bwdif` on the software path, `deinterlace_vaapi`
   * on the GPU. Both pass frames that are not flagged interlaced through untouched.
   */
  deinterlace?: boolean;
  /**
   * Convert an SDR picture to BT.709 limited range inside the scale filter. Meant for sources
   * tagged BT.601 or full range: an SD BT.601 picture upscaled to HD is otherwise decoded with
   * BT.709 coefficients and its hues shift. Both scalers read the input matrix and range from the
   * frame's own tags, so only request this for sources whose tags are known. Ignored for
   * `inputColor: "hdr"`, whose tonemap already lands on BT.709 limited range.
   */
  convertToBt709?: boolean;
  /**
   * Input transfer characteristics: `"hdr"` (PQ/HLG) inserts a tonemap to BT.709 SDR. Without it,
   * HDR sources get range-squashed into SDR and look washed out.
   */
  inputColor: "sdr" | "hdr";
  /** Burn subtitles into the video: a text file through libass, or an image subtitle stream. */
  subtitle?: TextSubtitleGraphSpec | ImageSubtitleGraphSpec;
  /**
   * The decoder emits system-memory frames (upload pipeline mode): prefix the GPU graph with
   * `hwupload` so scale/tonemap/overlay still run on the device. Software graphs ignore this.
   */
  uploadInput?: boolean;
};

/**
 * A text subtitle file burned by libass (`subtitles=`). `startTime` is the input `-ss` seek offset:
 * an input seek re-stamps frame PTS from 0, but libass picks cues by PTS, so the subtitle filter
 * must see media-clock timestamps (see {@link subtitlePtsSandwich}). `fontsDir` adds the fonts an
 * ASS track was authored with (MKV font attachments) to libass's font lookup.
 */
export type TextSubtitleGraphSpec = {
  kind?: "text";
  path: string;
  fontsDir?: string;
  startTime: number;
};

/**
 * An image subtitle stream (PGS, VobSub, DVB) of input 0, by subtitle-relative index (`0:s:<i>`).
 * ffmpeg decodes it into transparent BGRA frames (sub2video) that are overlaid on the video. No
 * seek compensation is needed: an input `-ss` re-stamps the subtitle stream together with the video,
 * so both stay on the same 0-based clock.
 */
export type ImageSubtitleGraphSpec = {
  kind: "image";
  streamIndex: number;
};

export type VideoGraph =
  /** Single-branch graph for `-vf`. */
  | { kind: "filterChain"; filters: string[] }
  /** Multi-branch graph for `-filter_complex`; map the labeled output (`-map [vout]`). */
  | { kind: "filterComplex"; graph: string[]; mapLabel: "vout" };

/**
 * Escape a path for use as a filter option value inside a filtergraph. Beyond the option-level
 * specials (`\`, `:`, `'`), the graph-level metacharacters (`,`, `;`, `[`, `]`) must be escaped
 * too once the filter lives in a `-filter_complex` spec.
 */
export function escapeFilterPath(p: string): string {
  return p.replaceAll(/[\\:',;[\]]/gu, (c) => `\\${c}`);
}

/**
 * Wrap a PTS-sensitive filter (i.e. `subtitles=`) so it sees media-clock timestamps after an
 * input `-ss` seek. `-ss` before `-i` re-stamps decoded PTS from 0; without compensation libass
 * renders the cues from the start of the file instead of the seek target. The leading
 * `setpts=PTS+SS/TB` restores the media clock for cue lookup; the trailing `setpts=PTS-SS/TB`
 * returns to 0-based PTS so downstream framesync (`overlay_vaapi`), `-r`, and muxing are
 * unaffected. No-op (no setpts pair) when the seek offset is 0.
 */
export function subtitlePtsSandwich(
  inner: string,
  startTime: number,
): string[] {
  if (startTime <= 0) return [inner];
  const ss = String(startTime);
  return [`setpts=PTS+${ss}/TB`, inner, `setpts=PTS-${ss}/TB`];
}

/**
 * Software HDR→SDR tonemap: linearize PQ/HLG (zimg, 100-nit SDR target), convert primaries
 * BT.2020→BT.709 in linear float RGB, compress highlights with Hable (desat=0 — zimg already
 * handled gamut, extra desaturation just washes colors out), then re-encode to limited-range
 * BT.709 8-bit. Runs after `scale`, so the float-RGB work is done at output resolution, not 4K.
 */
export const SOFTWARE_TONEMAP_CHAIN =
  "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709," +
  "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

/**
 * Spell a frame rate the way `-r` and the lavfi `r=` option should read it: an integer as itself
 * (so integer rates render exactly as they always have), an NTSC rate as its exact `N/1001`
 * rational rather than a 17-digit float, and anything else as the plain number.
 */
export function formatFrameRate(rate: number): string {
  if (Number.isInteger(rate)) return String(rate);
  const ntscNumerator = Math.round(rate * 1001);
  return ntscNumerator % 1000 === 0 &&
    Math.abs(ntscNumerator / 1001 - rate) < 1e-9
    ? `${String(ntscNumerator)}/1001`
    : String(rate);
}

/** Scale options converting an SDR picture to BT.709 limited range (`scale` and `scale_vaapi` share the names). */
const BT709_LIMITED_SCALE_OPTIONS = ":out_color_matrix=bt709:out_range=tv";

/**
 * The `subtitles=` burn filter (libass). `alpha` is enabled on the GPU overlay canvas branch;
 * `fontsdir` adds the source's attached fonts (ASS tracks name the fonts they were styled with).
 */
function subtitlesFilter(
  subtitle: TextSubtitleGraphSpec,
  alpha: boolean,
): string {
  const fonts =
    subtitle.fontsDir === undefined
      ? ""
      : `:fontsdir=${escapeFilterPath(subtitle.fontsDir)}`;
  return `subtitles=filename=${escapeFilterPath(subtitle.path)}${fonts}${alpha ? ":alpha=1" : ""}`;
}

function videoInputLabel(
  spec: Pick<VideoGraphSpec, "videoStreamIndex">,
): string {
  return spec.videoStreamIndex === undefined
    ? "[0:v]"
    : `[0:v:${String(spec.videoStreamIndex)}]`;
}

/**
 * The image-subtitle branch: the input's subtitle stream decoded to BGRA frames, fitted inside the
 * picture without distortion (a Blu-ray's 1920x1080 PGS canvas over a 1920x804 scope encode keeps
 * its shape and every cue stays visible) and centered on a transparent `canvas`-sized frame so the
 * overlay composites at 0,0. A subtitle canvas that already matches the picture passes through
 * unscaled. BGRA is what `hwupload` → `overlay_vaapi` accepts on the GPU path.
 */
function imageSubtitleBranch(
  streamIndex: number,
  fit: { width: number; height: number },
  canvas: { width: number; height: number },
): string {
  return (
    `[0:s:${String(streamIndex)}]` +
    `scale=${String(fit.width)}:${String(fit.height)}:force_original_aspect_ratio=decrease,` +
    `pad=${String(canvas.width)}:${String(canvas.height)}:-1:-1:color=black@0,format=bgra`
  );
}

/**
 * Software video graph: optional deinterlace → scale (optionally to BT.709) → optional letterbox
 * pad → optional HDR tonemap → optional subtitle burn → encoder output filters (e.g. `hwupload`
 * when a hardware encoder consumes software-decoded frames). Deinterlace runs first so field
 * combing is never scaled. Subtitles burn after the tonemap so they land on SDR `yuv420p` frames —
 * burning before would tonemap the subtitle pixels themselves (and libass can't take the chain's
 * intermediate float-RGB format anyway).
 *
 * A text subtitle stays a single `-vf` chain (`subtitles=`, PTS-compensated). An image subtitle
 * needs a second input branch, so it becomes a `-filter_complex` graph that `overlay`s the
 * subtitle stream; `eof_action=pass` keeps the picture going after the last cue.
 */
export function buildSoftwareVideoGraph(
  spec: VideoGraphSpec & {
    pad?: { width: number; height: number };
    encoderOutFilters: readonly string[];
  },
): VideoGraph {
  const { width, height, inputColor, subtitle, pad, encoderOutFilters } = spec;
  const toBt709 = spec.convertToBt709 === true && inputColor === "sdr";
  const picture = [
    ...(spec.deinterlace === true
      ? ["bwdif=mode=send_frame:deint=interlaced"]
      : []),
    `scale=${String(width)}:${String(height)}${toBt709 ? BT709_LIMITED_SCALE_OPTIONS : ""}`,
    ...(pad
      ? [`pad=${String(pad.width)}:${String(pad.height)}:-1:-1:color=black`]
      : []),
    ...(inputColor === "hdr" ? [SOFTWARE_TONEMAP_CHAIN] : []),
  ];
  const outFilters = encoderOutFilters.filter((filter) => filter.length > 0);
  if (subtitle?.kind === "image") {
    const canvas = pad ?? { width, height };
    return {
      kind: "filterComplex",
      graph: [
        `${videoInputLabel(spec)}${picture.join(",")}[main]`,
        `${imageSubtitleBranch(subtitle.streamIndex, { width, height }, canvas)}[subs]`,
        `[main][subs]${["overlay=eof_action=pass", ...outFilters].join(",")}[vout]`,
      ],
      mapLabel: "vout",
    };
  }
  const filters = [
    ...picture,
    ...(subtitle
      ? subtitlePtsSandwich(
          subtitlesFilter(subtitle, false),
          subtitle.startTime,
        )
      : []),
    ...outFilters,
  ];
  return { kind: "filterChain", filters };
}

/**
 * VAAPI GPU video graph. Frames stay GPU surfaces end to end:
 * - Interlaced: `deinterlace_vaapi` (frame-rate output, flagged frames only) ahead of the scale.
 * - SDR: `scale_vaapi` to NV12 (what h264_vaapi consumes), optionally converting to BT.709.
 * - HDR: scale first in 10-bit P010 (keeps precision, and the tonemap VPP then processes output-
 *   resolution pixels instead of 4K), then `tonemap_vaapi` to BT.709 NV12.
 * - Text subtitles: a `color@0` transparent BGRA canvas (vanilla-ffmpeg stand-in for
 *   jellyfin-ffmpeg's `alphasrc`) is rendered by libass (`alpha=1`), uploaded, and blended with
 *   `overlay_vaapi`. BGRA is deliberate: it's libass's native composition format and iHD
 *   `hwupload` accepts it, while planar YUV+alpha has no VAAPI surface format. `shortest=1` ends
 *   the graph with the video, since the canvas source is infinite.
 * - Image subtitles: the input's subtitle stream replaces the canvas — decoded to BGRA, fitted and
 *   padded to the picture size in software (only the subtitle frames, never the video), then
 *   uploaded and blended with the same `overlay_vaapi`. The subtitle stream ends before the video,
 *   so `eof_action=pass` (not `shortest`) keeps the picture going after the last cue.
 */
export function buildVaapiVideoGraph(spec: VideoGraphSpec): VideoGraph {
  const { width, height, frameRate, inputColor, subtitle, uploadInput } = spec;
  const scale =
    inputColor === "hdr"
      ? `scale_vaapi=w=${String(width)}:h=${String(height)}:format=p010,` +
        "tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709"
      : `scale_vaapi=w=${String(width)}:h=${String(height)}:format=nv12${spec.convertToBt709 === true ? BT709_LIMITED_SCALE_OPTIONS : ""}`;
  // Upload mode: the decoder emitted system-memory frames; put them on the device first so the
  // rest of the graph is unchanged. See PrepareStreamOptions.hardwarePipelineMode.
  const base = [
    ...(uploadInput === true ? ["hwupload"] : []),
    ...(spec.deinterlace === true
      ? ["deinterlace_vaapi=rate=frame:auto=1"]
      : []),
    scale,
  ].join(",");
  if (!subtitle) {
    return { kind: "filterChain", filters: [base] };
  }
  const baseBranch = `${videoInputLabel(spec)}${base}[base]`;
  if (subtitle.kind === "image") {
    const size = { width, height };
    return {
      kind: "filterComplex",
      graph: [
        baseBranch,
        `${imageSubtitleBranch(subtitle.streamIndex, size, size)},hwupload[subs]`,
        "[base][subs]overlay_vaapi=eof_action=pass[vout]",
      ],
      mapLabel: "vout",
    };
  }
  const canvas = `color=c=black@0:s=${String(width)}x${String(height)}${frameRate === undefined ? "" : `:r=${formatFrameRate(frameRate)}`}`;
  const subsBranch = [
    canvas,
    "format=bgra",
    ...subtitlePtsSandwich(subtitlesFilter(subtitle, true), subtitle.startTime),
    "hwupload",
  ].join(",");
  return {
    kind: "filterComplex",
    graph: [
      baseBranch,
      `${subsBranch}[subs]`,
      "[base][subs]overlay_vaapi=shortest=1[vout]",
    ],
    mapLabel: "vout",
  };
}

