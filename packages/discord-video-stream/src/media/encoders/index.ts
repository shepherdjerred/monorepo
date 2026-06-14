import type { SupportedVideoCodec } from "../../utils.js";
import type { VideoGraph, VideoGraphSpec } from "../videoGraph.js";

export type EncoderSettings = {
  name: string;
  options: string[];
  /**
   * Output options for the software-decode path only (e.g. the device init that `outFilters`'
   * `hwupload` needs). NOT applied when `hwPipeline` is active — the pipeline's `decodeOptions`
   * already initialize the device, and a second `-init_hw_device` with the same name is a hard
   * ffmpeg error.
   */
  globalOptions?: string[];
  outFilters?: string[];
  /**
   * Optional full-GPU pipeline for a hardware encoder. When present *and* hardware-accelerated
   * decoding is enabled, `prepareStream` decodes straight into GPU surfaces (via `decodeOptions`,
   * replacing the generic `-hwaccel auto`) and builds the whole video graph on the GPU (via
   * `videoGraph`: scale, HDR tonemap, and subtitle overlay — replacing the software `scale`).
   * It also skips `-pix_fmt yuv420p` and the encoder's `outFilters` (hwupload/format), since the
   * frames are already hardware surfaces.
   */
  hwPipeline?: {
    /** Input options that decode into GPU surfaces (e.g. `-hwaccel vaapi -hwaccel_output_format vaapi`). */
    decodeOptions: string[];
    /** Builds the GPU video graph (scale / tonemap / subtitle overlay) for this encoder family. */
    videoGraph: (spec: VideoGraphSpec) => VideoGraph;
  };
};

export type EncoderSettingsGetter = (
  bitrate: number,
  bitrateMax: number,
) => Partial<Record<SupportedVideoCodec, EncoderSettings>>;

import { software } from "./software.js";
import { nvenc } from "./nvenc.js";
import { vaapi } from "./vaapi.js";
import { merge } from "./merge.js";

const Encoders = {
  software,
  nvenc,
  vaapi,
  merge,
};

export { Encoders };
