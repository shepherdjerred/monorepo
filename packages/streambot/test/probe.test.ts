import { describe, expect, test } from "bun:test";
import {
  isHdrTransfer,
  parseFfprobeOutput,
  resolutionBucket,
} from "@shepherdjerred/streambot/sources/probe.ts";

describe("resolutionBucket", () => {
  test("buckets common heights", () => {
    expect(resolutionBucket(2160)).toBe("2160p");
    expect(resolutionBucket(1440)).toBe("1440p");
    expect(resolutionBucket(1080)).toBe("1080p");
    expect(resolutionBucket(720)).toBe("720p");
    expect(resolutionBucket(480)).toBe("sd");
    expect(resolutionBucket()).toBe("unknown");
  });
});

describe("isHdrTransfer", () => {
  test("recognises PQ and HLG as HDR", () => {
    expect(isHdrTransfer("smpte2084")).toBe(true);
    expect(isHdrTransfer("arib-std-b67")).toBe(true);
    expect(isHdrTransfer("bt709")).toBe(false);
    expect(isHdrTransfer()).toBe(false);
  });
});

describe("parseFfprobeOutput", () => {
  test("extracts a 2160p HEVC 10-bit HDR + TrueHD remux (the incident source)", () => {
    const info = parseFfprobeOutput({
      streams: [
        {
          codec_type: "video",
          codec_name: "hevc",
          width: 3840,
          height: 2160,
          pix_fmt: "yuv420p10le",
          color_transfer: "smpte2084",
        },
        { codec_type: "audio", codec_name: "truehd", channels: 8 },
      ],
      format: { duration: "10862.123" },
    });
    expect(info).not.toBeNull();
    expect(info?.videoCodec).toBe("hevc");
    expect(info?.height).toBe(2160);
    expect(info?.hdr).toBe(true);
    expect(info?.audioCodec).toBe("truehd");
    expect(info?.audioChannels).toBe(8);
    expect(info?.durationSeconds).toBeCloseTo(10_862.123, 2);
  });

  test("falls back to 'unknown' codecs when streams are missing", () => {
    const info = parseFfprobeOutput({ streams: [] });
    expect(info?.videoCodec).toBe("unknown");
    expect(info?.audioCodec).toBe("unknown");
    expect(info?.hdr).toBe(false);
    expect(info?.durationSeconds).toBeUndefined();
  });

  test("returns null for malformed input", () => {
    expect(parseFfprobeOutput({ streams: "not-an-array" })).toBeNull();
    expect(parseFfprobeOutput(null)).toBeNull();
  });
});
