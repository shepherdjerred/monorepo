import { describe, expect, test } from "bun:test";
import { Encoders } from "../src/media/encoders/index.ts";

// Guards the full-GPU VAAPI pipeline declaration consumed by prepareStream: a hardware decode
// option set that keeps frames as GPU surfaces, a GPU scale filter (replacing software swscale),
// and VBR rate control so -b:v/-maxrate/-bufsize are honored (h264_vaapi defaults to AVBR).
describe("Encoders.vaapi", () => {
  const settings = Encoders.vaapi({ device: "/dev/dri/renderD128" })(4000, 8000);

  test("declares a full-GPU pipeline for each VAAPI codec", () => {
    for (const codec of ["H264", "H265", "AV1"] as const) {
      const s = settings[codec];
      expect(s).toBeDefined();
      expect(s?.hwPipeline?.decodeOptions).toEqual([
        "-hwaccel",
        "vaapi",
        "-hwaccel_output_format",
        "vaapi",
        "-hwaccel_device",
        "/dev/dri/renderD128",
      ]);
      expect(s?.hwPipeline?.scaleFilter(1920, 1080)).toBe(
        "scale_vaapi=w=1920:h=1080:format=nv12",
      );
    }
  });

  test("pins VBR rate control on H264 only (H265/AV1 VBR is driver-dependent)", () => {
    expect(settings.H264?.options).toEqual(["-rc_mode", "VBR"]);
    expect(settings.H265?.options).toEqual([]);
    expect(settings.AV1?.options).toEqual([]);
  });

  test("threads the configured render device into both decode and -vaapi_device", () => {
    const custom = Encoders.vaapi({ device: "/dev/dri/renderD129" })(4000, 8000);
    expect(custom.H264?.hwPipeline?.decodeOptions).toContain("/dev/dri/renderD129");
    expect(custom.H264?.globalOptions).toEqual(["-vaapi_device", "/dev/dri/renderD129"]);
  });
});
