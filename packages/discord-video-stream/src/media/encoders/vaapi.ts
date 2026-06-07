import type { EncoderSettingsGetter } from "./index.js";

type VaapiSettings = {
  device?: string;
};

export function vaapi({
  device = "/dev/dri/renderD128",
}: Partial<VaapiSettings> = {}) {
  // Shared across codecs. The full-GPU pipeline (hardware decode into VAAPI surfaces + GPU
  // `scale_vaapi`) is codec-agnostic; it replaces the software `scale` (swscale) that otherwise
  // downloads every frame to system memory and scales on the CPU — the bottleneck on
  // high-resolution sources (e.g. 4K remuxes). `outFilters` are kept for the (uncommon) path where
  // the VAAPI encoder is used without hardware decode (software-decoded frames are uploaded here);
  // when `hwPipeline` is active these are skipped (frames are already GPU surfaces).
  const shared = {
    globalOptions: ["-vaapi_device", device],
    outFilters: ["format=nv12|vaapi", "hwupload"],
    hwPipeline: {
      decodeOptions: [
        "-hwaccel",
        "vaapi",
        "-hwaccel_output_format",
        "vaapi",
        "-hwaccel_device",
        device,
      ],
      scaleFilter: (width: number, height: number) =>
        `scale_vaapi=w=${width}:h=${height}:format=nv12`,
    },
  };
  return (() => ({
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
  })) as EncoderSettingsGetter;
}
