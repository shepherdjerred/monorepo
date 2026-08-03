import type { EncoderSettingsGetter } from "./index.js";
import { buildVaapiVideoGraph } from "../videoGraph.js";

type VaapiSettings = {
  device?: string;
  /**
   * `-async_depth` for the VAAPI encoders: how many frames the encode pipeline
   * may hold in flight. ffmpeg's default (2) keeps one extra frame queued in
   * the encode FIFO, adding ~one frame-interval of steady-state latency.
   * Realtime consumers (discord-plays-mario-kart) pass 1 to trade pipelining
   * throughput for latency. Omitted → flag not emitted, ffmpeg default kept.
   */
  asyncDepth?: number;
};

export function vaapi({
  device = "/dev/dri/renderD128",
  asyncDepth,
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
      // No `-hwaccel_output_format vaapi`: still a GPU decode, but frames land in system memory
      // and the graph's leading `hwupload` (spec.uploadInput) puts them back on the device. Used
      // as the recovery pipeline for sources whose mid-stream hwaccel flip crashes the full-GPU
      // graph (ffmpeg "Impossible to convert between the formats", exit 218).
      uploadDecodeOptions: [
        ...deviceOptions,
        "-hwaccel",
        "vaapi",
        "-hwaccel_device",
        "va",
      ],
      videoGraph: buildVaapiVideoGraph,
    },
  };
  // `-async_depth` is a base VAAPI-encode option shared by all three codecs.
  const asyncDepthOptions =
    asyncDepth === undefined ? [] : ["-async_depth", String(asyncDepth)];
  return () => ({
    // VBR rate control so `-b:v`/`-maxrate`/`-bufsize` are honored. h264_vaapi defaults to AVBR,
    // which logs "Buffering settings are ignored" and leaves the bitrate effectively uncapped —
    // bitrate spikes can overwhelm the realtime Discord send path.
    H264: {
      name: "h264_vaapi",
      options: ["-rc_mode", "VBR", ...asyncDepthOptions],
      ...shared,
    },
    // H265/AV1 keep the VAAPI default rate control: VBR support for these codecs is hardware-/
    // driver-dependent (some iHD versions reject `-rc_mode VBR` for av1_vaapi). streambot only
    // encodes H264, so these are validated only as far as the shared GPU pipeline.
    H265: {
      name: "hevc_vaapi",
      options: [...asyncDepthOptions],
      ...shared,
    },
    AV1: {
      name: "av1_vaapi",
      options: [...asyncDepthOptions],
      ...shared,
    },
  });
}
