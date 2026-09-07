import { describe, expect, test } from "vitest";
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

  test("seeks BOTH inputs when a split source starts at an offset", () => {
    const { command, output, promise } = prepareStream("video.nut", {
      includeAudio: true,
      startTime: 42,
      audioInput: {
        source: "tcp://127.0.0.1:1",
        inputOptions: ["-f", "s16le", "-ar", "44100", "-ac", "2"],
      },
    });
    promise.catch(() => {});
    try {
      const args = ffmpegArgs(command);
      // `-ss` is an input option — it seeks only the input it precedes. Applying it to input 0
      // alone starts the picture at 42s while its soundtrack restarts from zero, so every resume,
      // crash retry and live seek on a split yt-dlp source plays the right video against the wrong
      // audio. Assert one `-ss 42` per input, positioned before its own `-i`.
      const seekPositions = args
        .map((arg, index) => ({ arg, index }))
        .filter(({ arg }) => arg === "-ss")
        .map(({ index }) => index);
      const inputPositions = args
        .map((arg, index) => ({ arg, index }))
        .filter(({ arg }) => arg === "-i")
        .map(({ index }) => index);
      expect(inputPositions).toHaveLength(2);
      expect(seekPositions).toHaveLength(2);
      for (const seek of seekPositions) expect(args[seek + 1]).toBe("42");
      expect(seekPositions[0]).toBeLessThan(inputPositions[0] ?? -1);
      expect(seekPositions[1]).toBeGreaterThan(inputPositions[0] ?? -1);
      expect(seekPositions[1]).toBeLessThan(inputPositions[1] ?? -1);
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });

  test("leaves the split audio input unseeked when playback starts at zero", () => {
    const { command, output, promise } = prepareStream("video.nut", {
      includeAudio: true,
      audioInput: {
        source: "tcp://127.0.0.1:1",
        inputOptions: ["-f", "s16le", "-ar", "44100", "-ac", "2"],
      },
    });
    promise.catch(() => {});
    try {
      // The control: no offset means no `-ss` anywhere, so the rawvideo bots' command line — which
      // uses `audioInput` and never seeks — is byte-identical to what it was before this fix.
      expect(ffmpegArgs(command)).not.toContain("-ss");
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });

  test("binds low-latency probe options to both live inputs", () => {
    const { command, output, promise } = prepareStream("video.nut", {
      includeAudio: true,
      minimizeLatency: true,
      audioInput: {
        source: "tcp://127.0.0.1:1",
        inputOptions: ["-f", "s16le", "-ar", "44100", "-ac", "2"],
      },
    });
    promise.catch(() => {});
    try {
      const args = ffmpegArgs(command);
      const inputIndexes = args.flatMap((arg, index) =>
        arg === "-i" ? [index] : [],
      );
      const noBufferIndexes = args.flatMap((arg, index) =>
        arg === "nobuffer" ? [index] : [],
      );
      const zeroAnalyzeIndexes = args.flatMap((arg, index) =>
        arg === "-analyzeduration" && args[index + 1] === "0" ? [index] : [],
      );
      expect(inputIndexes).toHaveLength(2);
      expect(noBufferIndexes).toHaveLength(2);
      expect(zeroAnalyzeIndexes).toHaveLength(2);
      expect(noBufferIndexes[0]).toBeLessThan(inputIndexes[0]);
      expect(zeroAnalyzeIndexes[0]).toBeLessThan(inputIndexes[0]);
      expect(noBufferIndexes[1]).toBeGreaterThan(inputIndexes[0]);
      expect(noBufferIndexes[1]).toBeLessThan(inputIndexes[1]);
      expect(zeroAnalyzeIndexes[1]).toBeGreaterThan(inputIndexes[0]);
      expect(zeroAnalyzeIndexes[1]).toBeLessThan(inputIndexes[1]);
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

// Realtime latency opt-ins added 2026-08-03 for discord-plays-mario-kart. Both default OFF; the
// assert-default cases protect streambot/pokemon, whose command lines must not change.
describe("prepareStream realtime latency opt-ins", () => {
  const liveAudioInput = {
    source: "tcp://127.0.0.1:1",
    inputOptions: ["-f", "s16le", "-ar", "44100", "-ac", "2"],
  };

  test("emits -flush_packets 1 and low-delay Opus flags when opted in", () => {
    const { command, output, promise } = prepareStream("video.nut", {
      includeAudio: true,
      lowLatencyMux: true,
      lowDelayAudio: true,
      audioInput: liveAudioInput,
    });
    promise.catch(() => {});
    try {
      const args = ffmpegArgs(command);
      const joined = args.join(" ");
      expect(joined).toContain("-flush_packets 1");
      expect(joined).toContain("-application lowdelay");
      expect(joined).toContain("-frame_duration 10");
      // The libopus private options must bind after the audio codec selection.
      expect(args.indexOf("lowdelay")).toBeGreaterThan(
        args.indexOf("libopus"),
      );
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });

  test("keeps the command unchanged when the opt-ins are omitted", () => {
    const { command, output, promise } = prepareStream("video.nut", {
      includeAudio: true,
      audioInput: liveAudioInput,
    });
    promise.catch(() => {});
    try {
      const joined = ffmpegArgs(command).join(" ");
      expect(joined).not.toContain("-flush_packets");
      expect(joined).not.toContain("lowdelay");
      expect(joined).not.toContain("-frame_duration");
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });

  test("lowDelayAudio emits no Opus flags on an audio-less stream", () => {
    const { command, output, promise } = prepareStream("video.nut", {
      includeAudio: false,
      lowLatencyMux: true,
      lowDelayAudio: true,
    });
    promise.catch(() => {});
    try {
      const joined = ffmpegArgs(command).join(" ");
      expect(joined).toContain("-flush_packets 1");
      expect(joined).not.toContain("lowdelay");
      expect(joined).not.toContain("-frame_duration");
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });
});

// Audio-only output, added 2026-09-06 so music can be played over the normal voice connection.
// Defaults OFF; the regression lock at the end of this block is what protects the rawvideo bots
// (discord-plays-pokemon, discord-plays-mario-kart), whose command line must not move at all.
describe("prepareStream audioOnly", () => {
  test("emits an audio-only command with a REQUIRED audio mapping", () => {
    const { command, output, promise } = prepareStream("song.webm", {
      audioOnly: true,
      readrate: 1,
      readrateInitialBurst: 2.5,
      startTime: 30,
    });
    promise.catch(() => {});
    try {
      const args = ffmpegArgs(command);
      const joined = args.join(" ");

      // `-map 0:a:0` without the `?`: audio is the only output stream, so a source that has none
      // must fail at ffmpeg startup rather than produce an empty NUT the consumer waits on forever.
      expect(joined).toContain("-vn");
      expect(joined).toContain("-map 0:a:0");
      expect(joined).not.toContain("-map 0:a:0?");

      // Input pacing and the audio encode are shared with the video path and stay exactly as they
      // are; `-f nut` + Opus is what LibavDemuxer's Opus-only allowlist accepts.
      expect(joined).toContain("-ss 30");
      expect(joined).toContain("-readrate 1");
      expect(joined).toContain("-readrate_initial_burst 2.5");
      expect(joined).toContain("-c:a libopus");
      expect(joined).toContain("-ar 48000");
      expect(joined).toContain("-ac 2");
      expect(args.slice(-4)).toEqual(["-nostats", "-f", "nut", "pipe:1"]);
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });

  test("emits no video mapping, encoder, or filter chain", () => {
    const { command, output, promise } = prepareStream("song.webm", {
      audioOnly: true,
    });
    promise.catch(() => {});
    try {
      const joined = ffmpegArgs(command).join(" ");
      for (const absent of [
        "-map 0:v",
        "-c:v",
        "-b:v",
        "-maxrate:v",
        "-bufsize:v",
        "-bf",
        "-pix_fmt",
        "-force_key_frames",
        "-filter:v",
        "-filter_complex",
        "-r ",
      ]) {
        expect(joined).not.toContain(absent);
      }
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });

  test("resolves no encoder and no hardware decode, even when both are requested", async () => {
    const { Encoders } = await import("../src/media/encoders/index.ts");
    const { command, output, promise } = prepareStream("song.webm", {
      audioOnly: true,
      hardwareAcceleratedDecoding: true,
      width: 1920,
      height: 1080,
      encoder: Encoders.vaapi({ device: "/dev/dri/renderD128" }),
    });
    promise.catch(() => {});
    try {
      const joined = ffmpegArgs(command).join(" ");
      // The point of skipping encoder resolution: a host with no /dev/dri must never be asked for
      // a VAAPI device to encode a stream that has no picture.
      expect(joined).not.toContain("-hwaccel");
      expect(joined).not.toContain("vaapi");
      expect(joined).not.toContain("renderD128");
      expect(joined).not.toContain("scale_vaapi");
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });

  test("rejects every option that cannot mean anything without video", () => {
    // All five guards. Each of these is a request the audio-only path cannot honor, and silently
    // dropping any of them would hand the caller a stream that looks fine and is missing exactly
    // what was asked for.
    expect(() =>
      prepareStream("song.webm", {
        audioOnly: true,
        subtitleBurn: { path: "/tmp/x.srt" },
      }),
    ).toThrow(/subtitleBurn cannot be applied when audioOnly/);
    expect(() =>
      prepareStream("song.webm", { audioOnly: true, noTranscoding: true }),
    ).toThrow(/noTranscoding cannot be combined with audioOnly/);
    expect(() =>
      prepareStream("song.webm", { audioOnly: true, includeAudio: false }),
    ).toThrow(/audioOnly requires includeAudio/);
    expect(() =>
      prepareStream("song.webm", {
        audioOnly: true,
        pad: { width: 1920, height: 1080 },
      }),
    ).toThrow(/pad cannot be applied when audioOnly/);
    expect(() =>
      prepareStream("song.webm", { audioOnly: true, inputColor: "hdr" }),
    ).toThrow(/inputColor 'hdr' cannot be applied when audioOnly/);
  });

  test("leaves those same options working on the video path", () => {
    // The control for the guards above: a fail-fast check earns its keep only if it fires on
    // exactly the contradiction and nothing else. `pad` and `inputColor` in particular are ordinary
    // video settings the rawvideo and movie paths use, so an over-broad guard would break them.
    const { command, output, promise } = prepareStream("video.mkv", {
      width: 1280,
      height: 720,
      pad: { width: 1920, height: 1080 },
      inputColor: "hdr",
    });
    promise.catch(() => {});
    try {
      const joined = ffmpegArgs(command).join(" ");
      expect(joined).toContain("pad=1920:1080");
      expect(joined).toContain("tonemap");
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });
});

describe("prepareStream audioVolume", () => {
  function volumeFilter(options: Parameters<typeof prepareStream>[1]): string {
    const { command, output, promise } = prepareStream("video.mkv", options);
    promise.catch(() => {});
    try {
      const args = ffmpegArgs(command);
      const filter = args[args.indexOf("-filter:a") + 1];
      return filter ?? "";
    } finally {
      killQuietly(command);
      output.destroy();
    }
  }

  test("defaults to the unity filter this option replaced", () => {
    // Spelled `1.0`, not `1`: the default must leave the command line byte-identical to what it
    // was before audioVolume existed.
    expect(volumeFilter({})).toBe("volume@internal_lib=1.0");
    expect(volumeFilter({ audioOnly: true })).toBe("volume@internal_lib=1.0");
  });

  test("applies a requested gain on both the video and the audio-only path", () => {
    expect(volumeFilter({ audioVolume: 0.5 })).toBe("volume@internal_lib=0.5");
    expect(volumeFilter({ audioVolume: 0.5, audioOnly: true })).toBe(
      "volume@internal_lib=0.5",
    );
  });

  test("keeps a requested mute muted", () => {
    // 0 is a volume, not a missing option. The merge deliberately does not use the
    // isFiniteNonZero guard the other numeric options use, which would promote it back to unity.
    expect(volumeFilter({ audioVolume: 0 })).toBe("volume@internal_lib=0");
  });

  test("falls back to unity for a value that is not a usable gain", () => {
    expect(volumeFilter({ audioVolume: Number.NaN })).toBe(
      "volume@internal_lib=1.0",
    );
    expect(volumeFilter({ audioVolume: -1 })).toBe("volume@internal_lib=1.0");
  });
});

describe("prepareStream default argument vector (regression lock)", () => {
  // discord-plays-pokemon and discord-plays-mario-kart run these exact command lines. `audioOnly`,
  // `audioVolume` and `audioSink` are additive and default-off; this pins the whole vector, in
  // order, so a future edit to the audio-only branches cannot quietly move a video argument.
  test("software default is unchanged", () => {
    const { command, output, promise } = prepareStream("video.mkv", {});
    promise.catch(() => {});
    try {
      expect([...ffmpegArgs(command)]).toEqual([
        "-i", "video.mkv",
        "-map", "0:v",
        "-b:v", "5000k",
        "-maxrate:v", "7000k",
        "-bufsize:v", "2500k",
        "-bf", "0",
        "-pix_fmt", "yuv420p",
        "-force_key_frames", "expr:gte(t,n_forced*1)",
        "-c:v", "libx264",
        "-forced-idr", "1",
        "-tune", "film",
        "-preset", "superfast",
        "-map", "0:a:0?",
        "-ac", "2",
        "-lfe_mix_level", "1",
        "-ar", "48000",
        "-c:a", "libopus",
        "-b:a", "128k",
        "-filter:v", "scale=-2:-2",
        "-filter:a", "volume@internal_lib=1.0",
        "-progress", "pipe:2",
        "-nostats",
        "-f", "nut",
        "pipe:1",
      ]);
    } finally {
      killQuietly(command);
      output.destroy();
    }
  });

  test("the rawvideo bots' live-input vector is unchanged", () => {
    const { command, output, promise } = prepareStream("video.mkv", {
      includeAudio: true,
      minimizeLatency: true,
      lowLatencyMux: true,
      lowDelayAudio: true,
      readrate: 1,
      readrateInitialBurst: 2.5,
      audioInput: {
        source: "tcp://127.0.0.1:1",
        inputOptions: ["-f", "s16le", "-ar", "44100", "-ac", "2"],
      },
    });
    promise.catch(() => {});
    try {
      expect([...ffmpegArgs(command)]).toEqual([
        "-readrate", "1",
        "-readrate_initial_burst", "2.5",
        "-fflags", "nobuffer",
        "-analyzeduration", "0",
        "-i", "video.mkv",
        "-fflags", "nobuffer",
        "-analyzeduration", "0",
        "-f", "s16le",
        "-ar", "44100",
        "-ac", "2",
        "-i", "tcp://127.0.0.1:1",
        "-map", "0:v",
        "-b:v", "5000k",
        "-maxrate:v", "7000k",
        "-bufsize:v", "2500k",
        "-bf", "0",
        "-pix_fmt", "yuv420p",
        "-force_key_frames", "expr:gte(t,n_forced*1)",
        "-c:v", "libx264",
        "-forced-idr", "1",
        "-tune", "film",
        "-preset", "superfast",
        "-flush_packets", "1",
        "-map", "1:a:0",
        "-ac", "2",
        "-lfe_mix_level", "1",
        "-ar", "48000",
        "-c:a", "libopus",
        "-b:a", "128k",
        "-application", "lowdelay",
        "-frame_duration", "10",
        "-filter:v", "scale=-2:-2",
        "-filter:a", "volume@internal_lib=1.0",
        "-progress", "pipe:2",
        "-nostats",
        "-f", "nut",
        "pipe:1",
      ]);
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
