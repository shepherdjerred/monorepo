import { expect, test } from "bun:test";
import {
  resolveReplayKeyframeTimes,
  validateCapturedSampleTimes,
  validateLoadedReplayLength,
} from "./capture-reference-positions.mjs";
import { captureReferencePositions } from "./research/reference-position-samples.mjs";

test("uses exact primary clocks for one-based keyframe ordinals", () => {
  const laterTime = Math.fround(60.011242);
  const chunks = [4, 2, 1, 2].map((stream, index) => {
    const bytes = Buffer.alloc(33);
    bytes.writeUInt32LE(index + 1, 0);
    bytes[8] = stream;
    bytes.writeUInt32LE(15, 9);
    bytes[17] = 4;
    bytes[18] = 0x31;
    bytes.writeFloatLE(index === 3 ? laterTime : 0, 19);
    bytes.writeFloatLE(index < 2 ? 0 : 60, 23);
    bytes[27] = 2;
    bytes.writeUInt16LE(1167, 28);
    bytes[32] = index < 2 ? 1 : 2;
    return bytes;
  });
  const bytes = Buffer.concat(chunks);
  const replay = {
    bytes,
    headerEnd: 0,
    end: bytes.length,
    build: "16.23.840.6595",
    protocol: "8bbfcd5af2bc92db",
    declaredChunkCount: chunks.length,
    duration: 90,
  };
  expect(resolveReplayKeyframeTimes(replay, "1,2")).toEqual({
    ordinals: [1, 2],
    times: [0, laterTime],
  });
  expect(() => resolveReplayKeyframeTimes(replay, "3")).toThrow(
    "Replay has 2 indexed keyframes",
  );
  for (const invalid of ["0", "1,1", "2,1", "1.5", "1,", "9007199254740993"])
    expect(() => resolveReplayKeyframeTimes(replay, invalid)).toThrow(
      "strictly increasing one-based keyframe ordinals",
    );
  expect(() =>
    resolveReplayKeyframeTimes({ ...replay, declaredChunkCount: 5 }, "2"),
  ).toThrow("Replay chunk count mismatch");
});

test("requires a client duration matching the replay footer by default", () => {
  expect(() =>
    validateLoadedReplayLength({ length: 1757.16394 }, 1757.163),
  ).not.toThrow();
  expect(() =>
    validateLoadedReplayLength({ length: 1763.16394 }, 1757.163),
  ).toThrow("Loaded replay duration differs from the local replay footer");
});

test("matches an explicit client duration without widening the tolerance", () => {
  expect(() =>
    validateLoadedReplayLength({ length: 1763.16394 }, 1757.163, 1763.16394),
  ).not.toThrow();
  expect(() =>
    validateLoadedReplayLength({ length: 1763.18394 }, 1757.163, 1763.16394),
  ).toThrow(
    "Loaded replay duration differs from the explicitly expected client length",
  );
});

const footerSeconds = 1757.163;
const clientSeconds = 1763.1639404296875;

test("rejects a continuous pause overshoot into the measured client tail after restoring the view", async () => {
  const originalPlayback = {
    paused: true,
    seeking: false,
    time: 7,
    speed: 1,
    length: clientSeconds,
  };
  const originalRender = { cameraAttached: false, cameraMode: "fps" };
  let playback = originalPlayback;
  let render = originalRender;
  const api = async (path, body) => {
    if (path === "render") {
      if (body)
        render = body.cameraAttached
          ? { ...body, cameraPosition: { x: 500, y: 1700, z: 500 } }
          : body;
      return render;
    }
    if (body) playback = { ...playback, ...body };
    return playback;
  };
  validateLoadedReplayLength(playback, footerSeconds, clientSeconds);
  const samples = await captureReferencePositions({
    api,
    participants: [{ key: 1, selectionName: "Fixture" }],
    times: [1757.16],
    delay: async () => {
      if (!playback.paused) playback = { ...playback, time: 1757.18 };
    },
  });
  expect(samples[0].time).toBe(1757.18);
  expect(playback).toEqual(originalPlayback);
  expect(render).toEqual(originalRender);
  expect(() =>
    validateCapturedSampleTimes(samples, footerSeconds, "continuous"),
  ).toThrow("outside the replay footer duration");
});

test("applies the footer boundary to every capture mode", () => {
  for (const method of ["continuous", "paused-seek"]) {
    expect(() =>
      validateCapturedSampleTimes(
        [{ time: footerSeconds }],
        footerSeconds,
        method,
      ),
    ).not.toThrow();
    expect(() =>
      validateCapturedSampleTimes([{ time: 1757.164 }], footerSeconds, method),
    ).toThrow("outside the replay footer duration");
  }
  expect(() =>
    validateCapturedSampleTimes(
      [{ timeBefore: 1757.16, timeAfter: footerSeconds }],
      footerSeconds,
      "continuous-follow",
    ),
  ).not.toThrow();
  expect(() =>
    validateCapturedSampleTimes(
      [{ timeBefore: 1757.16, timeAfter: 1757.18 }],
      footerSeconds,
      "continuous-follow",
    ),
  ).toThrow("outside the replay footer duration");
});
