import { describe, expect, test } from "vitest";
import {
  isHdrTransfer,
  parseFfprobeOutput,
  redactProbeError,
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

test("ffprobe diagnostics do not retain signed source URLs", () => {
  const source = "https://cdn.example/live.m3u8?token=secret123";
  const message = `Failed to read ${source}; redirected to https://cdn2.example/a?sig=abc`;
  const redacted = redactProbeError(message, source);
  expect(redacted).not.toContain("secret123");
  expect(redacted).not.toContain("sig=abc");
  expect(redacted).toContain("[redacted media URL]");
});

test("ffprobe diagnostics remove keys echoed from per-input decryption options", () => {
  const key = "11".repeat(16);
  expect(
    redactProbeError(
      `Invalid key ${key}`,
      "https://fixture.example/manifest.mpd",
      ["-cenc_decryption_key", key],
    ),
  ).toBe("Invalid key <redacted>");
});

test("ffprobe diagnostics redact nested HLS decryption options and echoed bare keys", () => {
  const key = "11".repeat(16);
  const option = `decryption_key=${key}`;
  expect(
    redactProbeError(`Failed ${option}; invalid key ${key}`, "fixture", [
      "-seg_format_options",
      option,
    ]),
  ).toBe("Failed <redacted>; invalid key <redacted>");
});

describe("isHdrTransfer", () => {
  test("recognises PQ and HLG as HDR", () => {
    expect(isHdrTransfer("smpte2084")).toBe(true);
    expect(isHdrTransfer("arib-std-b67")).toBe(true);
    expect(isHdrTransfer("bt709")).toBe(false);
    expect(isHdrTransfer()).toBe(false);
  });
});

/** A 5.1 E-AC-3 source whose video stream carries the given ffprobe fields. */
function videoOf(stream: Record<string, unknown>) {
  return parseFfprobeOutput({
    streams: [
      { codec_type: "video", codec_name: "h264", ...stream },
      {
        codec_type: "audio",
        codec_name: "eac3",
        channels: 6,
        channel_layout: "5.1(side)",
      },
    ],
  });
}

describe("parseFfprobeOutput", () => {
  test("selects the complete A/V rendition when an HLS master has empty first tracks", () => {
    const info = parseFfprobeOutput({
      streams: [
        { codec_type: "video", codec_name: "h264", width: 0, height: 0 },
        { codec_type: "audio", codec_name: "aac", channels: 0 },
        { codec_type: "video", codec_name: "h264", width: 960, height: 540 },
        { codec_type: "audio", codec_name: "aac", channels: 2 },
      ],
    });
    expect(info).toMatchObject({
      videoStreamIndex: 1,
      audioStreamIndex: 1,
      width: 960,
      height: 540,
      audioChannels: 2,
    });
  });

  test("preserves FFmpeg video indexes when cover art precedes the playable stream", () => {
    const info = parseFfprobeOutput({
      streams: [
        {
          codec_type: "video",
          codec_name: "mjpeg",
          width: 600,
          height: 600,
          disposition: { attached_pic: 1 },
        },
        { codec_type: "video", codec_name: "h264", width: 1280, height: 720 },
        { codec_type: "audio", codec_name: "aac", channels: 2 },
      ],
    });
    expect(info?.videoStreamIndex).toBe(1);
    expect(info?.videoCodec).toBe("h264");
  });

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

  describe("display properties", () => {
    test("a scope film keeps its 2.39:1 display aspect", () => {
      const info = videoOf({ width: 1920, height: 804 });
      expect(info?.video?.displayAspect).toBeCloseTo(2.388, 3);
      expect(info?.video?.rotation).toBe(0);
    });

    test("anamorphic pixels widen the display aspect (16:9 NTSC DVD)", () => {
      const info = videoOf({
        width: 720,
        height: 480,
        sample_aspect_ratio: "32:27",
      });
      expect(info?.video?.displayAspect).toBeCloseTo(16 / 9, 3);
    });

    test("an unknown 0:1 pixel aspect is treated as square", () => {
      const info = videoOf({
        width: 1440,
        height: 1080,
        sample_aspect_ratio: "0:1",
      });
      expect(info?.video?.displayAspect).toBeCloseTo(4 / 3, 3);
    });

    test("a display-matrix rotation of -90 makes a landscape grid portrait", () => {
      const info = videoOf({
        width: 1920,
        height: 1080,
        side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }],
      });
      expect(info?.video?.rotation).toBe(90);
      expect(info?.video?.displayAspect).toBeCloseTo(9 / 16, 3);
    });

    test("the legacy rotate tag is honoured when there is no display matrix", () => {
      const info = videoOf({
        width: 1920,
        height: 1080,
        tags: { rotate: "270" },
      });
      expect(info?.video?.rotation).toBe(270);
      expect(info?.video?.displayAspect).toBeCloseTo(9 / 16, 3);
    });

    test("upside-down video keeps its landscape aspect", () => {
      const info = videoOf({
        width: 1920,
        height: 1080,
        side_data_list: [{ rotation: 180 }],
      });
      expect(info?.video?.rotation).toBe(180);
      expect(info?.video?.displayAspect).toBeCloseTo(16 / 9, 3);
    });

    test("reads frame rate, interlacing, and colour", () => {
      const info = videoOf({
        width: 720,
        height: 480,
        field_order: "tt",
        avg_frame_rate: "30000/1001",
        r_frame_rate: "60000/1001",
        color_space: "smpte170m",
        color_range: "tv",
      });
      expect(info?.video?.interlaced).toBe(true);
      expect(info?.video?.frameRate).toBeCloseTo(29.97, 2);
      expect(info?.video?.colorSpace).toBe("smpte170m");
      expect(info?.video?.colorRange).toBe("tv");
    });

    test("falls back to r_frame_rate when the average is 0/0", () => {
      const info = videoOf({
        width: 1920,
        height: 1080,
        field_order: "progressive",
        avg_frame_rate: "0/0",
        r_frame_rate: "24000/1001",
      });
      expect(info?.video?.interlaced).toBe(false);
      expect(info?.video?.frameRate).toBeCloseTo(23.976, 3);
    });

    test("reports the selected audio stream's channel layout", () => {
      const info = videoOf({ width: 1920, height: 1080 });
      expect(info?.audio).toEqual({ channels: 6, channelLayout: "5.1(side)" });
    });

    test("a stream without usable dimensions has no display properties", () => {
      expect(videoOf({ width: 0, height: 0 })?.video).toBeUndefined();
    });
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
