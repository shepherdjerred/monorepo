import type { SupportedVideoCodec } from "../../utils.js";

export type EncoderSettings = {
  name: string;
  options: string[];
  globalOptions?: string[];
  outFilters?: string[];
  /**
   * Optional full-GPU pipeline for a hardware encoder. When present *and* hardware-accelerated
   * decoding is enabled, `prepareStream` decodes straight into GPU surfaces (via `decodeOptions`,
   * replacing the generic `-hwaccel auto`) and scales on the GPU (via `scaleFilter`, replacing the
   * software `scale`). It also skips `-pix_fmt yuv420p` and the encoder's `outFilters`
   * (hwupload/format), since the frames are already hardware surfaces.
   */
  hwPipeline?: {
    /** Input options that decode into GPU surfaces (e.g. `-hwaccel vaapi -hwaccel_output_format vaapi`). */
    decodeOptions: string[];
    /** Builds the GPU scale filter (e.g. `scale_vaapi=w=1920:h=1080:format=nv12`). */
    scaleFilter: (width: number, height: number) => string;
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
