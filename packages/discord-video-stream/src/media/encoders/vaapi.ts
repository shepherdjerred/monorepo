import type { EncoderSettingsGetter } from "./index.js";
import { buildVaapiVideoGraph } from "../videoGraph.js";

type VaapiSettings = {
  device?: string;
};

export function vaapi({
  device = "/dev/dri/renderD128",
}: Partial<VaapiSettings> = {}): EncoderSettingsGetter {
  // Shared across codecs. The full-GPU pipeline (hardware decode into VAAPI surfaces + GPU
  // scale/tonemap/subtitle-overlay via `buildVaapiVideoGraph`) is codec-agnostic; it replaces the
  // software `scale` (swscale) that otherwise downloads every frame to system memory and scales on
  // the CPU — the bottleneck on high-resolution sources (e.g. 4K remuxes). `outFilters` are kept
  // for the (uncommon) path where the VAAPI encoder is used without hardware decode
  // (software-decoded frames are uploaded here); when `hwPipeline` is active these are skipped
  // (frames are already GPU surfaces).
  //
  // Device plumbing: one named device (`va`) created with `-init_hw_device` and shared by the
  // decoder (`-hwaccel_device va`) and every filter (`-filter_hw_device va`). `overlay_vaapi`
  // requires both of its inputs on the same device context, which separate `-vaapi_device` /
  // `-hwaccel_device <path>` instances would break.
  const deviceOptions = [
    "-init_hw_device",
    `vaapi=va:${device}`,
    "-filter_hw_device",
    "va",
  ];
  const shared = {
    // Software-decode path only (prepareStream skips these when hwPipeline engages): the
    // `outFilters` hwupload below needs the filter device.
    globalOptions: deviceOptions,
    outFilters: ["format=nv12|vaapi", "hwupload"],
    hwPipeline: {
      decodeOptions: [
        ...deviceOptions,
        "-hwaccel",
        "vaapi",
        "-hwaccel_output_format",
        "vaapi",
        "-hwaccel_device",
        "va",
      ],
      videoGraph: buildVaapiVideoGraph,
    },
  };
  return () => ({
    // VBR rate control so `-b:v`/`-maxrate`/`-bufsize` are honored. h264_vaapi defaults to AVBR,
    // which logs "Buffering settings are ignored" and leaves the bitrate effectively uncapped —
    // bitrate spikes can overwhelm the realtime Discord send path.
    H264: {
      name: "h264_vaapi",
      options: ["-rc_mode", "VBR"],
      ...shared,
    },
    // H265/AV1 keep the VAAPI default rate control: VBR support for these codecs is hardware-/
    // driver-dependent (some iHD versions reject `-rc_mode VBR` for av1_vaapi). streambot only
    // encodes H264, so these are validated only as far as the shared GPU pipeline.
    H265: {
      name: "hevc_vaapi",
      options: [],
      ...shared,
    },
    AV1: {
      name: "av1_vaapi",
      options: [],
      ...shared,
    },
  });
}
