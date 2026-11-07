import { expect, test } from "bun:test";
import {
  LatestDirectReplyLoop,
  LatestDesiredReplayClock,
} from "./latest-direct-reply-loop.mjs";
import { LatestDirectEffectPresentation } from "./latest-direct-effect-presentation.mjs";
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fixture(overrides = {}) {
  const calls = [],
    errors = [],
    draws = [],
    order = [];
  let time = 1;
  const presentation = new LatestDirectEffectPresentation({
    frame: (at, camera) =>
      new Promise((resolve, reject) =>
        calls.push({ at, camera, resolve, reject }),
      ),
    camera: (camera) =>
      new Promise((resolve, reject) =>
        calls.push({ at: time, camera, resolve, reject }),
      ),
  });
  const loop = new LatestDirectReplyLoop({
    now: () => time,
    nextIntent: () => ({
      time,
      key: String(time),
      camera: { right: [1, 0, 0], up: [0, 1, 0] },
    }),
    request: (intent) => {
      order.push("request:" + intent.time);
      return presentation.sample(intent.time, intent.camera);
    },
    accept: (r) => presentation.isCurrent(r),
    claim: (r, e) => presentation.claimCurrent(r, e),
    isClaimCurrent: (t, e) => presentation.isClaimCurrent(t, e),
    release: (t) => presentation.releaseClaim(t),
    present: (r) => {
      order.push("present:" + r.result.time);
      draws.push(r);
    },
    onError: (e) => errors.push(e),
    ...overrides,
  });
  return {
    loop,
    calls,
    errors,
    draws,
    order,
    presentation,
    setTime: (t) => {
      time = t;
    },
    finish: (i = 0) =>
      calls[i].resolve({
        time: calls[i].at,
        draws: [],
        metrics: { simulationSteps: i + 1 },
      }),
  };
}
test("desired wall clock ignores worker pacing and preserves pause/rate/seek anchors", () => {
  const c = new LatestDesiredReplayClock(
    { time: 69, playing: true, speed: 1, endTime: 120 },
    1000,
  );
  expect(c.read(2500)).toBe(70.5);
  c.configure(
    { time: c.read(2500), playing: true, speed: 4, endTime: 120 },
    2500,
  );
  expect(c.read(3000)).toBe(72.5);
  c.configure(
    { time: c.read(3000), playing: false, speed: 4, endTime: 120 },
    3000,
  );
  expect(c.read(9000)).toBe(72.5);
  c.configure({ time: 74, playing: true, speed: 1, endTime: 120 }, 9000);
  expect(c.read(10000)).toBe(75);
});
test("claim survives next ordinary request; one flight/ready is consumed synchronously before next callback", async () => {
  const f = fixture();
  f.loop.tick();
  f.setTime(2);
  f.loop.tick();
  expect(f.calls).toHaveLength(1);
  f.finish();
  await flush();
  expect(f.order).toEqual(["request:1", "request:2", "present:1"]);
  expect(f.draws).toHaveLength(1);
  expect(f.presentation.isCurrent(f.draws[0].result)).toBe(false);
  expect(f.loop.snapshot().inFlight).toBe(true);
  expect(f.loop.snapshot().ready).toBe(false);
  f.finish(1);
  await flush();
  expect(f.draws.map((r) => r.result.time)).toEqual([1, 2]);
  expect(f.calls).toHaveLength(2);
  expect(f.errors).toEqual([]);
});
test("seek epochs retain accepted operations but reject obsolete display, including reentrant intent", async () => {
  const f = fixture();
  f.loop.tick();
  f.loop.invalidate();
  f.setTime(0.5);
  f.finish();
  await flush();
  expect(f.draws).toHaveLength(0);
  expect(f.calls).toHaveLength(2);
  f.finish(1);
  await flush();
  expect(f.draws[0].result.time).toBe(0.5);
  expect(f.loop.snapshot().epochRejected).toBe(1);
  const g = fixture({
    present: () => {
      throw Error("present failure");
    },
  });
  g.loop.tick();
  g.finish();
  await flush();
  expect(g.loop.snapshot().ready).toBe(false);
  expect(g.errors[0].message).toBe("present failure");
});
test("callback failures close explicitly without unobserved continuation rejection", async () => {
  for (const key of [
    "accept",
    "claim",
    "isClaimCurrent",
    "release",
    "present",
  ]) {
    const f = fixture({
      [key]: () => {
        throw Error(key);
      },
    });
    f.loop.tick();
    f.finish();
    await flush();
    expect(f.errors[0]?.message).toBe(key);
    expect(f.loop.closed).toBe(true);
    expect(f.loop.ready).toBeNull();
  }
  const f = fixture({ present: () => Promise.reject(Error("async")) });
  f.loop.tick();
  f.finish();
  await flush();
  expect(f.errors[0].message).toContain("synchronously");
});
test("explicit reentrant invalidation cannot present a previously claimed epoch", async () => {
  let f,
    count = 0;
  f = fixture({
    nextIntent: () => {
      if (++count === 2) f.loop.invalidate();
      return {
        time: count,
        key: String(count),
        camera: { right: [1, 0, 0], up: [0, 1, 0] },
      };
    },
  });
  f.loop.tick();
  f.finish();
  await flush();
  expect(f.draws).toHaveLength(0);
  expect(f.loop.ready).toBeNull();
  expect(f.loop.counts.epochRejected).toBe(1);
  expect(f.errors).toEqual([]);
});

test("capture lock rejects an old accepted view without cancelling simulation and resumes only after release", async () => {
  const { LatestDirectCaptureOwnership } =
    await import("./latest-viewer-frame-coordination.mjs");
  const ownership = new LatestDirectCaptureOwnership();
  let f;
  f = fixture({
    nextIntent: () =>
      ownership.blocksOrdinary(false)
        ? null
        : { time: 1, key: "1", camera: { right: [1, 0, 0], up: [0, 1, 0] } },
    accept: (r) =>
      !ownership.blocksOrdinary(false) && f.presentation.isCurrent(r),
  });
  f.loop.tick();
  const lock = ownership.acquire();
  f.finish();
  await flush();
  expect(f.loop.counts.completed).toBe(1);
  expect(f.draws).toHaveLength(0);
  expect(f.calls).toHaveLength(1);
  ownership.release(lock);
  f.loop.tick();
  expect(f.calls).toHaveLength(2);
  f.finish(1);
  await flush();
  expect(f.draws).toHaveLength(1);
  expect(f.loop.counts.completed).toBe(2);
});
