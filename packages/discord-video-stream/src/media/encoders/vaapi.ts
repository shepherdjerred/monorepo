import type { EncoderSettingsGetter } from "./index.js";

type VaapiSettings = {
  device?: string;
};

export function vaapi({
  device = "/dev/dri/renderD128",
}: Partial<VaapiSettings> = {}) {
  const props = {
    // VBR rate control so `-b:v`/`-maxrate`/`-bufsize` are honored. h264_vaapi defaults to AVBR,
    // which logs "Buffering settings are ignored" and leaves the bitrate effectively uncapped —
    // bitrate spikes can overwhelm the realtime Discord send path.
    options: ["-rc_mode", "VBR"],
    globalOptions: ["-vaapi_device", device],
    // Kept for the (uncommon) path where the VAAPI encoder is used without hardware decode:
    // software-decoded frames are uploaded to the GPU here. When `hwPipeline` is active these are
    // skipped (frames are already GPU surfaces).
    outFilters: ["format=nv12|vaapi", "hwupload"],
    // Full-GPU pipeline: decode straight into VAAPI surfaces and scale on the GPU, replacing the
    // software `scale` (swscale) that otherwise downloads every frame to system memory and scales
    // on the CPU — the bottleneck on high-resolution sources (e.g. 4K remuxes).
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
    H264: {
      name: "h264_vaapi",
      ...props,
    },
    H265: {
      name: "hevc_vaapi",
      ...props,
    },
    AV1: {
      name: "av1_vaapi",
      ...props,
    },
  })) as EncoderSettingsGetter;
}
