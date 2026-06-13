import { describe, expect, test } from "bun:test";
import { Encoders } from "../src/media/encoders/index.ts";
import { buildVaapiVideoGraph } from "../src/media/videoGraph.ts";

// Guards the full-GPU VAAPI pipeline declaration consumed by prepareStream: a hardware decode
// option set that keeps frames as GPU surfaces, the GPU video-graph builder (scale/tonemap/
// subtitle-overlay, replacing software swscale), and VBR rate control so -b:v/-maxrate/-bufsize
// are honored (h264_vaapi defaults to AVBR).
describe("Encoders.vaapi", () => {
  const settings = Encoders.vaapi({ device: "/dev/dri/renderD128" })(4000, 8000);

  test("declares a full-GPU pipeline for each VAAPI codec", () => {
    for (const codec of ["H264", "H265", "AV1"] as const) {
      const s = settings[codec];
      expect(s).toBeDefined();
      // One named device (`va`) shared by decoder and filters: overlay_vaapi requires both of its
      // inputs on the same device context, so the decoder must reference the filter device by name.
      expect(s?.hwPipeline?.decodeOptions).toEqual([
        "-init_hw_device",
        "vaapi=va:/dev/dri/renderD128",
        "-filter_hw_device",
        "va",
        "-hwaccel",
        "vaapi",
        "-hwaccel_output_format",
        "vaapi",
        "-hwaccel_device",
        "va",
      ]);
      expect(s?.hwPipeline?.videoGraph).toBe(buildVaapiVideoGraph);
    }
  });

  test("pins VBR rate control on H264 only (H265/AV1 VBR is driver-dependent)", () => {
    expect(settings.H264?.options).toEqual(["-rc_mode", "VBR"]);
    expect(settings.H265?.options).toEqual([]);
    expect(settings.AV1?.options).toEqual([]);
  });

  test("threads the configured render device into decode and software-path global options", () => {
    const custom = Encoders.vaapi({ device: "/dev/dri/renderD129" })(4000, 8000);
    expect(custom.H264?.hwPipeline?.decodeOptions).toContain(
      "vaapi=va:/dev/dri/renderD129",
    );
    // globalOptions serve the software-decode + outFilters(hwupload) path; prepareStream must not
    // apply them when hwPipeline is active (decodeOptions already init the same named device).
    expect(custom.H264?.globalOptions).toEqual([
      "-init_hw_device",
      "vaapi=va:/dev/dri/renderD129",
      "-filter_hw_device",
      "va",
    ]);
  });
});
