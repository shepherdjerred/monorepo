import { expect, test } from "bun:test";
import {
  captureContinuousFollow,
  captureReferencePositions,
} from "./reference-position-samples.mjs";

const participants = [
  { key: 3, selectionName: "First" },
  { key: 7, selectionName: "Second" },
];

function fakeReplay({ unstable = false, step = 0.25, moving = false } = {}) {
  const originalRender = { cameraMode: "top", cameraAttached: false };
  const originalPlayback = {
    time: 20,
    speed: 2,
    paused: false,
    seeking: false,
  };
  let render = originalRender;
  let playback = { ...originalPlayback };
  const seeks = [];
  const speeds = [];
  const api = async (path, body) => {
    if (path === "render") {
      if (body && playback.seeking) throw Error("Render changed during seek");
      if (body) render = body;
      if (!render.cameraAttached) return render;
      const selectionName = unstable
        ? "Wrong"
        : render.selectionName.toLowerCase();
      return {
        ...render,
        selectionName,
        cameraPosition:
          selectionName === "first"
            ? { x: 400 + (moving ? playback.time * 10 : 0), y: 1607, z: -300 }
            : { x: 900, y: 1610, z: 150 },
      };
    }
    if (path !== "playback") throw Error("Unexpected API call");
    if (body) {
      if (body.time !== undefined) seeks.push(body.time);
      if (body.paused === false) speeds.push(body.speed ?? playback.speed);
      playback = { ...playback, ...body };
      if (body.time !== undefined) playback.seeking = true;
    }
    return { ...playback };
  };
  return {
    api,
    delay: async () => {
      if (playback.seeking) playback.seeking = false;
      if (!playback.paused) playback.time += step;
    },
    seeks,
    speeds,
    expectRestored() {
      expect(render).toEqual(originalRender);
      expect(playback).toEqual(originalPlayback);
    },
  };
}

test("captures stable camera observations after uninterrupted forward playback", async () => {
  const fake = fakeReplay();
  const result = await captureReferencePositions({
    api: fake.api,
    delay: fake.delay,
    participants,
    times: [1, 1.5],
  });
  expect(result).toEqual([
    { key: 3, requestedTime: 1, time: 1, position: [400, 7, 800] },
    { key: 7, requestedTime: 1, time: 1, position: [900, 10, 1250] },
    { key: 3, requestedTime: 1.5, time: 1.5, position: [400, 7, 800] },
    { key: 7, requestedTime: 1.5, time: 1.5, position: [900, 10, 1250] },
  ]);
  expect(fake.seeks).toEqual([0, 20]);
  expect(fake.speeds).toEqual([1, 1, 2]);
  fake.expectRestored();
});

test("rejects an unstable attachment and restores the original view", async () => {
  const fake = fakeReplay({ unstable: true });
  await expect(
    captureReferencePositions({
      api: fake.api,
      delay: fake.delay,
      participants,
      times: [1],
    }),
  ).rejects.toThrow("Unstable reference attachment at 1");
  expect(fake.seeks).toEqual([0, 20]);
  fake.expectRestored();
});

test("seeks directly to each snapshot, waits, and samples while paused", async () => {
  const fake = fakeReplay();
  const samples = await captureReferencePositions({
    api: fake.api,
    delay: fake.delay,
    participants: [participants[0]],
    times: [31, 60.017],
    method: "paused-seek",
  });
  expect(samples).toEqual([
    { key: 3, requestedTime: 31, time: 31, position: [400, 7, 800] },
    { key: 3, requestedTime: 60.017, time: 60.017, position: [400, 7, 800] },
  ]);
  expect(fake.seeks).toEqual([31, 60.017, 20]);
  expect(fake.speeds).toEqual([2]);
  fake.expectRestored();
});

test("rejects an unstable snapshot attachment and restores after the seek", async () => {
  const fake = fakeReplay({ unstable: true });
  await expect(
    captureReferencePositions({
      api: fake.api,
      delay: fake.delay,
      participants,
      times: [31, 60.017],
      method: "paused-seek",
    }),
  ).rejects.toThrow("Unstable reference attachment at 31");
  expect(fake.seeks).toEqual([31, 20]);
  expect(fake.speeds).toEqual([2]);
  fake.expectRestored();
});

test("follows one actor through all cues from zero at 1x and restores the view", async () => {
  const fake = fakeReplay({ step: 0.02, moving: true });
  const captures = await captureContinuousFollow({
    api: fake.api,
    delay: fake.delay,
    participant: participants[0],
    times: [0.2, 0.3, 0.4],
  });
  expect(captures[0].timeAfter).toBeLessThanOrEqual(0.2);
  expect(captures.some((sample) => sample.timeAfter > 0.3)).toBe(true);
  expect(captures.at(-1).timeBefore).toBeGreaterThanOrEqual(0.4);
  expect(captures.at(-1).position[0]).toBeGreaterThan(captures[0].position[0]);
  expect(captures.every((sample) => sample.key === participants[0].key)).toBe(
    true,
  );
  expect(fake.seeks).toEqual([0, 20]);
  expect(fake.speeds).toEqual([1, 2]);
  fake.expectRestored();
});

test("settles at a pre-window seek before attaching and records its provenance", async () => {
  const fake = fakeReplay({ step: 0.02, moving: true });
  const anchors = [];
  const samples = await captureContinuousFollow({
    api: fake.api,
    delay: fake.delay,
    participant: participants[0],
    times: [238.6, 239.2, 240.5],
    followFrom: 238,
    onAnchor: (anchor) => anchors.push(anchor),
  });
  expect(anchors).toEqual([
    {
      startMode: "paused-seek",
      requestedAnchorSeconds: 238,
      observedAnchorSeconds: 238,
    },
  ]);
  expect(samples[0].timeAfter).toBeLessThanOrEqual(238.6);
  expect(samples.at(-1).timeBefore).toBeGreaterThanOrEqual(240.5);
  expect(fake.seeks).toEqual([238, 20]);
  expect(fake.speeds).toEqual([1, 2]);
  fake.expectRestored();
});

test("rejects an anchor at the capture window start without touching playback", async () => {
  await expect(
    captureContinuousFollow({
      api: () => {
        throw Error("Unexpected API use");
      },
      participant: participants[0],
      times: [1, 2, 3],
      followFrom: 1,
    }),
  ).rejects.toThrow("anchor must be earlier");
});

test("rejects a lost attachment or sample gap and restores the view", async () => {
  const lost = fakeReplay({ step: 0.02 });
  let wasPlaying = false;
  const api = async (path, body) => {
    const reply = await lost.api(path, body);
    if (path === "playback" && body?.paused === false) wasPlaying = true;
    if (path === "render" && body === undefined && wasPlaying)
      return { ...reply, cameraAttached: false };
    return reply;
  };
  await expect(
    captureContinuousFollow({
      api,
      delay: lost.delay,
      participant: participants[0],
      times: [0, 0.2, 0.4],
    }),
  ).rejects.toThrow("camera attachment changed");
  lost.expectRestored();

  const gapped = fakeReplay({ step: 0.25 });
  await expect(
    captureContinuousFollow({
      api: gapped.api,
      delay: gapped.delay,
      participant: participants[0],
      times: [0, 0.2, 0.5],
    }),
  ).rejects.toThrow("sample gap or clock regression");
  gapped.expectRestored();
});
