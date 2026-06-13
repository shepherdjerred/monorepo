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
  /** Output width (concrete positive — GPU scale filters reject the `-2` aspect shorthand). */
  width: number;
  /** Output height (concrete positive). */
  height: number;
  /**
   * Frame rate for the subtitle canvas branch. Should match the output rate so `overlay_vaapi`'s
   * framesync doesn't duplicate/drop overlay frames; omitted → lavfi `color` default (25fps).
   */
  frameRate?: number;
  /**
   * Input transfer characteristics: `"hdr"` (PQ/HLG) inserts a tonemap to BT.709 SDR. Without it,
   * HDR sources get range-squashed into SDR and look washed out.
   */
  inputColor: "sdr" | "hdr";
  /**
   * Burn this subtitle file into the video. `startTime` is the input `-ss` seek offset: an input
   * seek re-stamps frame PTS from 0, but libass picks cues by PTS, so the subtitle filter must see
   * media-clock timestamps (see {@link subtitlePtsSandwich}).
   */
  subtitle?: { path: string; startTime: number };
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

/** The `subtitles=` burn filter (libass). `alpha` is enabled on the GPU overlay canvas branch. */
function subtitlesFilter(path: string, alpha: boolean): string {
  return `subtitles=filename=${escapeFilterPath(path)}${alpha ? ":alpha=1" : ""}`;
}

/**
 * Software (`-vf`) video graph: scale → optional letterbox pad → optional HDR tonemap → optional
 * subtitle burn (PTS-compensated) → encoder output filters (e.g. `hwupload` when a hardware
 * encoder consumes software-decoded frames). Subtitles burn after the tonemap so libass renders
 * onto SDR `yuv420p` frames — burning before would tonemap the subtitle pixels themselves (and
 * libass can't take the chain's intermediate float-RGB format anyway).
 */
export function buildSoftwareVideoGraph(
  spec: VideoGraphSpec & {
    pad?: { width: number; height: number };
    encoderOutFilters: readonly string[];
  },
): VideoGraph {
  const { width, height, inputColor, subtitle, pad, encoderOutFilters } = spec;
  const filters = [
    `scale=${width}:${height}`,
    ...(pad ? [`pad=${pad.width}:${pad.height}:-1:-1:color=black`] : []),
    ...(inputColor === "hdr" ? [SOFTWARE_TONEMAP_CHAIN] : []),
    ...(subtitle
      ? subtitlePtsSandwich(
          subtitlesFilter(subtitle.path, false),
          subtitle.startTime,
        )
      : []),
    ...encoderOutFilters,
  ].filter((filter) => filter.length > 0);
  return { kind: "filterChain", filters };
}

/**
 * VAAPI GPU video graph. Frames stay GPU surfaces end to end:
 * - SDR: `scale_vaapi` to NV12 (what h264_vaapi consumes).
 * - HDR: scale first in 10-bit P010 (keeps precision, and the tonemap VPP then processes output-
 *   resolution pixels instead of 4K), then `tonemap_vaapi` to BT.709 NV12.
 * - Subtitles: a `color@0` transparent BGRA canvas (vanilla-ffmpeg stand-in for jellyfin-ffmpeg's
 *   `alphasrc`) is rendered by libass (`alpha=1`), uploaded, and blended with `overlay_vaapi`.
 *   BGRA is deliberate: it's libass's native composition format and iHD `hwupload` accepts it,
 *   while planar YUV+alpha has no VAAPI surface format.
 */
export function buildVaapiVideoGraph(spec: VideoGraphSpec): VideoGraph {
  const { width, height, frameRate, inputColor, subtitle } = spec;
  const base =
    inputColor === "hdr"
      ? `scale_vaapi=w=${width}:h=${height}:format=p010,` +
        "tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709"
      : `scale_vaapi=w=${width}:h=${height}:format=nv12`;
  if (!subtitle) {
    return { kind: "filterChain", filters: [base] };
  }
  const canvas = `color=c=black@0:s=${width}x${height}${frameRate === undefined ? "" : `:r=${frameRate}`}`;
  const subsBranch = [
    canvas,
    "format=bgra",
    ...subtitlePtsSandwich(
      subtitlesFilter(subtitle.path, true),
      subtitle.startTime,
    ),
    "hwupload",
  ].join(",");
  return {
    kind: "filterComplex",
    graph: [
      `[0:v]${base}[base]`,
      `${subsBranch}[subs]`,
      "[base][subs]overlay_vaapi[vout]",
    ],
    mapLabel: "vout",
  };
}
