import { expect, test } from "bun:test";
import { LatestGpuTimings } from "./latest-gpu-timings.mjs";

function device({ supported = true } = {}) {
  const state = {
    created: [],
    deleted: [],
    disjoint: false,
    lost: false,
    active: null,
    reads: 0,
  };
  return Object.assign(state, {
    QUERY_RESULT_AVAILABLE: 1,
    QUERY_RESULT: 2,
    CURRENT_QUERY: 5,
    getExtension: () =>
      supported ? { TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 } : null,
    isContextLost: () => state.lost,
    getParameter: () => state.disjoint,
    getQuery: () => state.active,
    createQuery: () => {
      const query = { ready: false, nanoseconds: 2500000 };
      state.created.push(query);
      return query;
    },
    beginQuery: (_target, query) => {
      if (state.active) throw Error("Overlapping device query");
      state.active = query;
    },
    endQuery: () => {
      if (!state.active) throw Error("Missing device query");
      state.active = null;
    },
    getQueryParameter: (query, key) => {
      if (key === 1) return query.ready;
      if (!query.ready) throw Error("Blocking result read");
      state.reads++;
      return query.nanoseconds;
    },
    deleteQuery: (query) => state.deleted.push(query),
  });
}

test("GPU query polling never reads an unavailable result and joins completed timings to their original frames", () => {
  const gl = device(),
    timer = new LatestGpuTimings(gl);
  const frame = { wallTime: 100, replayTime: 69 };
  expect(timer.begin(frame)).toBe(true);
  frame.replayTime = 99;
  timer.end();
  timer.poll();
  expect(gl.reads).toBe(0);
  gl.created[0].ready = true;
  timer.poll();
  const result = timer.finish();
  expect(result.samples).toEqual([
    { wallTime: 100, replayTime: 69, gpuMs: 2.5 },
  ]);
  expect(result.pendingWhenStopped).toBe(0);
  expect(gl.deleted).toHaveLength(1);
});

test("query pressure skips measurements and stops without waiting for the GPU", () => {
  const gl = device(),
    timer = new LatestGpuTimings(gl, { maximumPending: 1 });
  timer.begin({ wallTime: 1 });
  timer.end();
  expect(timer.begin({ wallTime: 2 })).toBe(false);
  const result = timer.finish();
  expect(gl.reads).toBe(0);
  expect(gl.created).toHaveLength(1);
  expect(gl.deleted).toHaveLength(1);
  expect(result.skippedCapacity).toBe(1);
  expect(result.pendingWhenStopped).toBe(1);
});

test("disjoint intervals discard pending GPU durations and do not start fresh measurements until recovered", () => {
  const gl = device(),
    timer = new LatestGpuTimings(gl);
  timer.begin({ wallTime: 1 });
  timer.end();
  gl.created[0].ready = true;
  gl.disjoint = true;
  expect(timer.begin({ wallTime: 2 })).toBe(false);
  expect(gl.reads).toBe(0);
  gl.disjoint = false;
  expect(timer.begin({ wallTime: 3 })).toBe(true);
  timer.end();
  gl.created[1].ready = true;
  const result = timer.finish();
  expect(result.samples.map((s) => s.wallTime)).toEqual([3]);
  expect(result.disjointDiscarded).toBe(1);
  expect(result.skippedDisjoint).toBe(1);
});

test("unsupported timers, context loss and sample exhaustion remain explicit recording boundaries", () => {
  const unsupported = device({ supported: false });
  const absent = new LatestGpuTimings(unsupported);
  expect(absent.begin({})).toBe(false);
  expect(absent.finish().boundary).toBe("gpu-timer-extension-unavailable");
  expect(unsupported.created).toHaveLength(0);
  const gl = device(),
    timer = new LatestGpuTimings(gl, { maximumSamples: 1 });
  timer.begin({});
  timer.end();
  gl.created[0].ready = true;
  expect(timer.begin({})).toBe(false);
  expect(timer.finish().boundary).toBe("gpu-timer-sample-capacity");
  const lost = device(),
    lostTimer = new LatestGpuTimings(lost);
  lostTimer.begin({});
  lostTimer.end();
  lost.lost = true;
  expect(lostTimer.begin({})).toBe(false);
  expect(lostTimer.finish().boundary).toBe("gpu-context-lost");
  expect(lost.deleted).toHaveLength(1);
});

test("out-of-order GPU completions retain frame ownership and delete each owned query once", () => {
  const gl = device(),
    timer = new LatestGpuTimings(gl);
  const first = { wallTime: 1, camera: { followed: "first" } };
  timer.begin(first);
  timer.end();
  first.camera.followed = "caller mutation";
  timer.begin({ wallTime: 2 });
  timer.end();
  timer.begin({ wallTime: 3 });
  timer.end();
  gl.created[1].ready = true;
  gl.created[1].nanoseconds = 4000000;
  timer.poll();
  expect(gl.reads).toBe(1);
  expect(gl.deleted).toEqual([gl.created[1]]);
  gl.created[0].ready = true;
  const result = timer.finish();
  expect(result.samples).toEqual([
    { wallTime: 2, gpuMs: 4 },
    { wallTime: 1, camera: { followed: "first" }, gpuMs: 2.5 },
  ]);
  expect(result.pendingWhenStopped).toBe(1);
  expect(new Set(gl.deleted).size).toBe(3);
  expect(gl.deleted).toHaveLength(3);
  expect(result.scope.unavailableResultsWaitedFor).toBe(false);
  expect(result.scope.effectsCostIsolated).toBe(false);
  expect(result.scope.acceptanceEstablished).toBe(false);
});

test("an external elapsed-time query remains untouched while measurement is skipped", () => {
  const gl = device(),
    timer = new LatestGpuTimings(gl);
  const external = { external: true };
  gl.active = external;
  expect(timer.begin({ wallTime: 1 })).toBe(false);
  timer.end();
  expect(gl.active).toBe(external);
  expect(gl.created).toHaveLength(0);
  expect(gl.deleted).toHaveLength(0);
  gl.active = null;
  expect(timer.begin({ wallTime: 2 })).toBe(true);
  timer.end();
  gl.created[0].ready = true;
  const result = timer.finish();
  expect(result.skippedExternalQuery).toBe(1);
  expect(result.samples.map((sample) => sample.wallTime)).toEqual([2]);
  expect(gl.deleted).toEqual(gl.created);
});

test("active and closed lifecycle guards never implicitly end an owned query", () => {
  const gl = device(),
    timer = new LatestGpuTimings(gl);
  timer.begin({ wallTime: 1 });
  const active = gl.active;
  expect(() => timer.begin({ wallTime: 2 })).toThrow("already active");
  expect(() => timer.finish()).toThrow("active GPU query");
  expect(gl.active).toBe(active);
  timer.end();
  timer.end();
  timer.finish();
  expect(() => timer.begin({})).toThrow("closed");
  expect(() => timer.finish()).toThrow("already closed");
  timer.poll();
  expect(gl.deleted).toEqual(gl.created);
});

test("allocation failure and invalid bounds remain explicit without fabricated GPU samples", () => {
  for (const capacity of [0, -1, 1.5, NaN, Infinity]) {
    expect(
      () => new LatestGpuTimings(device(), { maximumPending: capacity }),
    ).toThrow();
    expect(
      () => new LatestGpuTimings(device(), { maximumSamples: capacity }),
    ).toThrow();
  }
  const gl = device(),
    timer = new LatestGpuTimings(gl);
  gl.createQuery = () => null;
  expect(timer.begin({ wallTime: 1 })).toBe(false);
  const result = timer.finish();
  expect(result.boundary).toBe("gpu-timer-allocation-failed");
  expect(result.samples).toHaveLength(0);
  expect(result.scope.acceptanceEstablished).toBe(false);
});
