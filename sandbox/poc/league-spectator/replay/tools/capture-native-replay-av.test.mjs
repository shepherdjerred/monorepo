import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  captureNativeReplayAv,
  recordingWindow,
} from "./capture-native-replay-av.mjs";
import { validateRecordingReceipt } from "./verify-native-recording-metadata.mjs";

const identity = {
  build: "16.21.829.8620",
  protocol: "fixture",
  durationMilliseconds: 5000,
  replaySha256: "a".repeat(64),
};

async function fixture(run, options = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "native-replay-av-test-"));
  const outputPath = resolve(root, "capture");
  const mediaPath = resolve(outputPath, "native-generated.webm");
  const playback = { length: 5, speed: 1, paused: false };
  const writes = [];
  let recording;
  let progress = 0;
  let clock = 0;
  const api = async (resource, body) => {
    if (body) writes.push([resource, body]);
    if (resource === "game")
      return { processID: recording && options.switchProcess ? 2 : 1 };
    if (resource === "playback")
      return { ...playback, length: options.loadedLength ?? playback.length };
    if (body?.recording === false) {
      if (options.stopFails) throw Error("stop request failed");
      return { recording: false };
    }
    if (!recording && !body) return { recording: options.busy ?? false };
    if (body) {
      recording = {
        ...body,
        replaySpeed: 1,
        path: options.wrongPath ? resolve(root, "outside.webm") : mediaPath,
      };
      await writeFile(mediaPath, "synthetic WebM placeholder");
      if (options.startAckLost) throw Error("start response lost");
    }
    if (options.recorderPhases) {
      const clock = [0.2, 0.8, 1, 2, 2.9][progress++];
      return clock === undefined
        ? { ...recording, recording: false, endTime: -1, currentTime: 3.2 }
        : { ...recording, currentTime: clock };
    }
    if (progress === 3) return { recording: false };
    const currentTime = options.truncated ? progress : progress * 2.5;
    progress++;
    return {
      ...recording,
      currentTime,
      path:
        options.replacementPath && progress > 1
          ? resolve(outputPath, "replacement.webm")
          : recording.path,
    };
  };
  const inspect = async () => ({
    tracks: (options.noAudio ? ["video"] : ["video", "audio"]).map((kind) => ({
      kind,
      packets: 300,
      packetsWithoutPts: 0,
      startPtsSeconds: 0,
      endPtsSeconds: options.shortTracks ? 4 : 5,
    })),
  });
  try {
    await run({
      outputPath,
      writes,
      capture: (overrides) =>
        captureNativeReplayAv({
          identity,
          outputPath,
          api,
          inspect,
          wait: async (milliseconds) => {
            clock += milliseconds;
          },
          now: () => clock,
          ...overrides,
        }),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("records the entire confirmed replay to a new directory and writes an unreviewed receipt", async () => {
  await fixture(async ({ capture, outputPath, writes }) => {
    const result = await capture();
    expect(result.window).toEqual({ startSeconds: 0, endSeconds: 5 });
    expect(result.mediaFile).toBe("native-generated.webm");
    expect(result.mediaSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.recordingProgress).toEqual({
      firstRecordingTime: 0,
      lastRecordingTime: 5,
      activeObservations: 3,
    });
    expect(writes).toEqual([
      ["playback", { paused: false, speed: 1 }],
      [
        "recording",
        {
          recording: true,
          path: outputPath,
          codec: "webm",
          startTime: 0,
          endTime: 5,
          framesPerSecond: 60,
          enforceFrameRate: true,
        },
      ],
    ]);
    expect(
      JSON.parse(await readFile(resolve(outputPath, "capture.json"), "utf8")),
    ).toEqual(result);
    expect(() => validateRecordingReceipt(identity, result)).toThrow(
      /independently reviewed/,
    );
    await expect(capture()).rejects.toThrow(
      /directory that does not already exist/,
    );
    expect(writes).toHaveLength(2);
  });
});

test("validates the window against both duration measurements", () => {
  expect(recordingWindow("0.25,1.5", 5, 2)).toEqual({
    startSeconds: 0.25,
    endSeconds: 1.5,
  });
  expect(() => recordingWindow(undefined, 5, 4)).toThrow(/inside both/);
  expect(() => recordingWindow("2,1", 5, 5)).toThrow(/inside both/);
  expect(() => recordingWindow("-1,5", 5, 5)).toThrow(/start and end/);
});

test("excludes seek pre-roll and accepts native completion after in-window progress", async () => {
  await fixture(
    async ({ capture }) => {
      const result = await capture({ windowArgument: "1,3" });
      expect(result.recordingProgress).toEqual({
        firstRecordingTime: 1,
        lastRecordingTime: 2.9,
        activeObservations: 3,
      });
      expect(result.reference.operatorReviewed).toBe(false);
    },
    { recorderPhases: true },
  );
});

test.each([
  [{ busy: true }, "no recording is active"],
  [{ loadedLength: 6 }, "differs from the local replay footer"],
])(
  "refuses unsafe preflight state %j without writing to the client",
  async (options, error) => {
    await fixture(async ({ capture, writes }) => {
      await expect(capture()).rejects.toThrow(error);
      expect(writes).toEqual([]);
    }, options);
  },
);

test("reports an absent native client and preserves its cause", async () => {
  await fixture(async ({ capture }) => {
    const refused = Object.assign(Error("refused"), { code: "ECONNREFUSED" });
    await expect(
      capture({
        api: async () => {
          throw refused;
        },
      }),
    ).rejects.toThrow(/Native Replay API is unavailable/);
  });
});

test("times out when Riot never enters recording state", async () => {
  await fixture(async ({ capture, outputPath }) => {
    await expect(
      capture({
        api: async (resource) => {
          if (resource === "game") return { processID: 1 };
          if (resource === "playback")
            return { length: 5, paused: false, speed: 1 };
          return { recording: false };
        },
      }),
    ).rejects.toThrow(/did not start the recording/);
    await expect(
      readFile(resolve(outputPath, "capture.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

test("stops its own recording after an ambiguous start response and preserves the capture error", async () => {
  await fixture(
    async ({ capture, writes }) => {
      await expect(capture()).rejects.toThrow("start response lost");
      expect(writes.at(-1)).toEqual(["recording", { recording: false }]);
    },
    { startAckLost: true },
  );
});

test("reports cleanup failure alongside the original capture failure", async () => {
  await fixture(
    async ({ capture, writes }) => {
      await expect(capture()).rejects.toMatchObject({
        message:
          "start response lost. Recording cleanup failed: stop request failed",
        cause: { message: "start response lost" },
      });
      expect(writes.at(-1)).toEqual(["recording", { recording: false }]);
    },
    { startAckLost: true, stopFails: true },
  );
});

test.each([
  [{ switchProcess: true }, "process changed"],
  [{ wrongPath: true }, "path outside"],
  [{ replacementPath: true }, "output changed"],
  [{ truncated: true }, "did not reach"],
  [{ noAudio: true }, "one audio track"],
  [{ shortTracks: true }, "do not span"],
])(
  "rejects incomplete evidence %j without writing a receipt",
  async (options, error) => {
    await fixture(async ({ capture, outputPath, writes }) => {
      await expect(capture()).rejects.toThrow(error);
      expect(writes).toHaveLength(2);
      await expect(
        readFile(resolve(outputPath, "capture.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }, options);
  },
);
