import { describe, expect, test } from "bun:test";
import {
  type FfmpegProcessHandle,
  prepareStream,
} from "../src/media/newApi.ts";

// Graph construction itself (scale/tonemap/subtitle ordering, GPU overlay branches, PTS
// compensation) is covered exhaustively in videoGraph.test.ts against the pure builders. These
// tests guard prepareStream's option handling around them.
describe("prepareStream subtitleBurn + noTranscoding guard", () => {
  test("throws instead of silently dropping a subtitle burn when noTranscoding is set", () => {
    expect(() =>
      prepareStream("input.mkv", {
        noTranscoding: true,
        subtitleBurn: { path: "/tmp/x.srt" },
      }),
    ).toThrow(/noTranscoding/);
  });
});

function ffmpegArgs(command: FfmpegProcessHandle): readonly string[] {
  return command.args;
}

function killQuietly(command: FfmpegProcessHandle): void {
  command.kill("SIGKILL");
}

describe("prepareStream audioInput", () => {
  test("maps audio from a separate second input when audioInput is set", () => {
    const { command, output, promise } = prepareStream("video.nut", {
      includeAudio: true,
      // tcp://…:1 refuses instantly if ffmpeg ever spawns; we only inspect args + kill.
      audioInput: {
        source: "tcp://127.0.0.1:1",
        inputOptions: ["-f", "s16le", "-ar", "44100", "-ac", "2"],
      },
    });
    promise.catch(() => {});
    try {
      const args = ffmpegArgs(command);
      const joined = args.join(" ");
      // Two inputs, audio mapped from input 1 (not the optional input-0 fallback).
      expect(args.filter((a) => a === "-i")).toHaveLength(2);
      expect(args).toContain("tcp://127.0.0.1:1");
      expect(joined).toContain("-map 1:a:0");
      expect(joined).not.toContain("-map 0:a:0?");
      expect(joined).toContain("s16le");
      expect(joined).toContain("libopus");
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });

  test("falls back to mapping audio from the primary input when audioInput is absent", () => {
    const { command, output, promise } = prepareStream("video.mkv", {
      includeAudio: true,
    });
    promise.catch(() => {});
    try {
      const args = ffmpegArgs(command);
      const joined = args.join(" ");
      expect(args.filter((a) => a === "-i")).toHaveLength(1);
      expect(joined).toContain("-map 0:a:0?");
      expect(joined).not.toContain("-map 1:a:0");
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });

  test("ignores audioInput when includeAudio is false (no audio mapping at all)", () => {
    const { command, output, promise } = prepareStream("video.nut", {
      includeAudio: false,
      audioInput: {
        source: "tcp://127.0.0.1:1",
        inputOptions: ["-f", "s16le", "-ar", "44100", "-ac", "2"],
      },
    });
    promise.catch(() => {});
    try {
      const args = ffmpegArgs(command);
      const joined = args.join(" ");
      expect(args.filter((a) => a === "-i")).toHaveLength(1);
      expect(joined).not.toContain("-map 1:a:0");
      expect(joined).not.toContain("-map 0:a:0?");
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });
});

describe("prepareStream readrate pacing", () => {
  test("emits -readrate_initial_burst alongside -readrate when both are set", () => {
    const { command, output, promise } = prepareStream("video.mkv", {
      readrate: 1,
      readrateInitialBurst: 2.5,
    });
    promise.catch(() => {});
    try {
      const joined = ffmpegArgs(command).join(" ");
      expect(joined).toContain("-readrate 1");
      expect(joined).toContain("-readrate_initial_burst 2.5");
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });

  test("omits -readrate_initial_burst when readrate is unset (burst is meaningless alone)", () => {
    const { command, output, promise } = prepareStream("video.mkv", {
      readrateInitialBurst: 2.5,
    });
    promise.catch(() => {});
    try {
      const joined = ffmpegArgs(command).join(" ");
      expect(joined).not.toContain("-readrate_initial_burst");
      expect(joined).not.toContain("-readrate ");
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });

  test("omits -readrate_initial_burst when only readrate is set (ffmpeg default 0.5s applies)", () => {
    const { command, output, promise } = prepareStream("video.mkv", {
      readrate: 1,
    });
    promise.catch(() => {});
    try {
      const joined = ffmpegArgs(command).join(" ");
      expect(joined).toContain("-readrate 1");
      expect(joined).not.toContain("-readrate_initial_burst");
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });
});

describe("prepareStream hardwarePipelineMode", () => {
  const hwOptions = {
    hardwareAcceleratedDecoding: true,
    width: 1920,
    height: 1080,
    inputColor: "hdr",
  } satisfies Parameters<typeof prepareStream>[1];

  async function importVaapi() {
    const { Encoders } = await import("../src/media/encoders/index.ts");
    return Encoders.vaapi({ device: "/dev/dri/renderD128" });
  }

  test('default ("full"): GPU output frames, no leading hwupload', async () => {
    const encoder = await importVaapi();
    const { command, output, promise } = prepareStream("video.mkv", {
      ...hwOptions,
      encoder,
    });
    promise.catch(() => {});
    try {
      const joined = ffmpegArgs(command).join(" ");
      expect(joined).toContain("-hwaccel_output_format vaapi");
      expect(joined).not.toContain("hwupload,scale_vaapi");
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });

  test('"upload": system-memory frames with a leading hwupload in the graph', async () => {
    const encoder = await importVaapi();
    const { command, output, promise } = prepareStream("video.mkv", {
      ...hwOptions,
      encoder,
      hardwarePipelineMode: "upload",
    });
    promise.catch(() => {});
    try {
      const joined = ffmpegArgs(command).join(" ");
      expect(joined).not.toContain("-hwaccel_output_format");
      expect(joined).toContain("-hwaccel vaapi");
      expect(joined).toContain(
        "hwupload,scale_vaapi=w=1920:h=1080:format=p010",
      );
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });

  test('"upload" is inert on the software pipeline (no hw pipeline engaged)', () => {
    const { command, output, promise } = prepareStream("video.mkv", {
      width: 1920,
      height: 1080,
      inputColor: "hdr",
      hardwarePipelineMode: "upload",
    });
    promise.catch(() => {});
    try {
      const joined = ffmpegArgs(command).join(" ");
      expect(joined).not.toContain("-hwaccel");
      expect(joined).not.toContain("hwupload");
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });
});
