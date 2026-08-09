import { describe, expect, it } from "bun:test";
import {
  H264_CODEC_STRING,
  buildDriverFeedArgs,
  driverFeedOutputSize,
  type DriverFeedEncoderOptions,
} from "./encoder.ts";

const BASE: DriverFeedEncoderOptions = {
  outputHeight: 480,
  frameRate: 30,
  bitrateKbps: 2500,
  bitrateMaxKbps: 4000,
  keyframeIntervalFrames: 30,
  hardwareAcceleration: false,
  vaapiDevice: "/dev/dri/renderD128",
  encoderAsyncDepth: 1,
};

/** Value following `flag`, so assertions do not depend on argument order. */
function valueOf(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

describe("driverFeedOutputSize", () => {
  it("aspect-corrects the anamorphic framebuffer to square pixels", () => {
    expect(driverFeedOutputSize(480)).toEqual({ width: 640, height: 480 });
    expect(driverFeedOutputSize(720)).toEqual({ width: 960, height: 720 });
  });

  it("keeps both dimensions even, as 4:2:0 chroma requires", () => {
    for (const height of [121, 241, 357, 483]) {
      const size = driverFeedOutputSize(height);
      expect(size.width % 2).toBe(0);
      expect(size.height % 2).toBe(0);
    }
  });
});

describe("buildDriverFeedArgs", () => {
  it("describes the emulator's raw BGRA output on stdin", () => {
    const args = buildDriverFeedArgs(BASE);
    expect(valueOf(args, "-f")).toBe("rawvideo");
    expect(valueOf(args, "-pix_fmt")).toBe("bgra");
    expect(valueOf(args, "-video_size")).toBe("640x240");
    expect(valueOf(args, "-i")).toBe("pipe:0");
  });

  it("emits an Annex-B elementary stream with AUD framing on stdout", () => {
    const args = buildDriverFeedArgs(BASE);
    // The splitter keys entirely on AUDs, so losing this filter silently breaks
    // access-unit boundaries rather than failing loudly.
    expect(valueOf(args, "-bsf:v")).toBe("h264_metadata=aud=insert");
    // Output muxer is the last `-f`; the leading one selects the rawvideo input.
    expect(args.slice(-3)).toEqual(["-f", "h264", "pipe:1"]);
  });

  it("pins the profile and level that H264_CODEC_STRING advertises", () => {
    const args = buildDriverFeedArgs(BASE);
    expect(valueOf(args, "-profile:v")).toBe("main");
    // "40", not "4.0": h264_vaapi rejects the dotted spelling.
    expect(valueOf(args, "-level")).toBe("40");
    expect(H264_CODEC_STRING).toBe("avc1.4D4028");
  });

  it("disables B-frames so access units leave in presentation order", () => {
    expect(valueOf(buildDriverFeedArgs(BASE), "-bf")).toBe("0");
  });

  it("pairs -g with -keyint_min so the keyframe cadence is exact", () => {
    const args = buildDriverFeedArgs({ ...BASE, keyframeIntervalFrames: 15 });
    expect(valueOf(args, "-g")).toBe("15");
    expect(valueOf(args, "-keyint_min")).toBe("15");
  });

  it("keeps the rate-control buffer near one frame to bound encoder latency", () => {
    const args = buildDriverFeedArgs(BASE);
    // 2500 kbps / 30 fps ~= 83 kbit per frame; two frames of slack.
    expect(valueOf(args, "-bufsize")).toBe("166k");
    expect(valueOf(args, "-b:v")).toBe("2500k");
    expect(valueOf(args, "-maxrate")).toBe("4000k");
  });

  it("uses libx264 with a forced-IDR keyframe cadence when there is no GPU", () => {
    const args = buildDriverFeedArgs(BASE);
    expect(valueOf(args, "-c:v")).toBe("libx264");
    expect(valueOf(args, "-tune")).toBe("zerolatency");
    // Without this, -g yields recovery points rather than true entry points.
    expect(valueOf(args, "-forced-idr")).toBe("1");
    expect(valueOf(args, "-vf")).toBe("scale=640:480,format=yuv420p");
    expect(args).not.toContain("-init_hw_device");
  });

  it("uploads to VAAPI and honours the async-depth latency knob when accelerated", () => {
    const args = buildDriverFeedArgs({
      ...BASE,
      hardwareAcceleration: true,
      encoderAsyncDepth: 1,
    });
    expect(valueOf(args, "-c:v")).toBe("h264_vaapi");
    expect(valueOf(args, "-init_hw_device")).toBe(
      "vaapi=va:/dev/dri/renderD128",
    );
    expect(valueOf(args, "-filter_hw_device")).toBe("va");
    expect(valueOf(args, "-vf")).toBe(
      "scale=640:480,format=nv12|vaapi,hwupload",
    );
    // VBR, else h264_vaapi ignores the bitrate ceiling entirely.
    expect(valueOf(args, "-rc_mode")).toBe("VBR");
    expect(valueOf(args, "-async_depth")).toBe("1");
  });

  it("carries no audio input — drivers keep Discord for sound", () => {
    expect(buildDriverFeedArgs(BASE)).toContain("-an");
  });
});
