// One isolated simultaneous birth group; clocks and lifetimes remain preview policy.
// Canonical ticks survive presentation samples. Fractional samples never become
// the starting state for subsequent simulation or backward seeking.
import { assertParentCamera } from "./latest-parent-frames.mjs";
import {
  buildParentMissileBursts,
  parentMissilePlacement,
  PARENT_MISSILE_POLICY,
} from "./latest-parent-missile-inputs.mjs";

// Offline probe schedules cross a JSON boundary, which represents -0 as 0.
// Match that supplied-pose contract here; never normalize native output bytes.
const preparedPose = (pose) =>
  Object.fromEntries(
    Object.entries(pose).map(([key, values]) => [
      key,
      values.map((v) => (Object.is(v, -0) ? 0 : v)),
    ]),
  );

export class LatestParentMissileTimeline {
  constructor(runtime, traces) {
    const groups = buildParentMissileBursts(traces);
    if (groups.length !== 1 || groups[0].effectId !== runtime.cache.effectId)
      throw Error(
        "Parent timeline requires one matching simultaneous birth group",
      );
    if (runtime.parents.size)
      throw Error("Parent timeline requires an exclusive empty runtime");
    this.runtime = runtime;
    this.group = groups[0];
    this.startTime = this.group.startTime;
    this.traces = [...traces].sort((a, b) => a.sequence - b.sequence);
    this.stopTimes = [
      ...new Set(this.traces.map((t) => Math.fround(t.stopTime))),
    ].sort((a, b) => a - b);
    this.parents = this.traces.map((trace, i) => {
      const source = this.group.parents[i];
      const handle = runtime.createParent({
        seed: BigInt(source.seed),
        clock: { ...source.clock, ticks: source.clock.ticks.map(BigInt) },
        placement: preparedPose(source.placement),
      });
      return { trace, handle, ownership: runtime.ownership(handle) };
    });
    // Stop exactly at birth is an admitted zero-length missile lifetime.
    const stopped = new Set();
    for (const { trace, handle } of this.parents)
      if (Math.fround(trace.stopTime) === this.startTime) {
        runtime.suspend(handle, true);
        stopped.add(trace.sequence);
      }
    this.birth = {
      token: runtime.checkpoint(),
      time: this.startTime,
      tick: 0,
      stopped,
      completeAt: null,
    };
    this.cursor = this.birth;
    this.liveCanonical = this.birth;
    this.closed = false;
  }
  summary() {
    this.check();
    return {
      effectId: this.group.effectId,
      startTime: this.startTime,
      policy: PARENT_MISSILE_POLICY,
      parents: this.parents.map(({ trace, ownership }) => ({
        sequence: trace.sequence,
        ownership,
      })),
    };
  }
  check() {
    if (this.closed) throw Error("Parent timeline is closed");
  }
  nextBoundary(state) {
    const tick = Math.fround(this.startTime + (state.tick + 1) / 60);
    if (tick <= state.time)
      throw Error(
        "Parent timeline clock cannot represent the next canonical tick",
      );
    const stop = this.stopTimes.find((t) => t > state.time);
    return stop === undefined ? tick : Math.min(tick, stop);
  }
  step(state, time, camera) {
    const runtime = this.runtime;
    for (const { trace, handle } of this.parents) {
      if (
        !state.stopped.has(trace.sequence) &&
        time >= Math.fround(trace.stopTime)
      ) {
        runtime.suspend(handle, true);
        state.stopped.add(trace.sequence);
      }
      runtime.setPlacement(
        handle,
        preparedPose(parentMissilePlacement(trace, time)),
        {
          captureState: false,
        },
      );
      runtime.advance(handle, time, 20, { captureState: false });
    }
    // The original writers touch CPU memory. Execute every canonical step's
    // geometry even when only the last step will be published to the caller.
    const parents = this.render(time, camera);
    state.time = time;
    if (time === Math.fround(this.startTime + (state.tick + 1) / 60))
      state.tick++;
    if (
      state.stopped.size === this.parents.length &&
      this.parents.every(
        ({ handle }) => runtime.completion(handle).nativeComplete,
      )
    )
      state.completeAt = time;
    return parents;
  }
  render(time, camera) {
    return this.parents.map(({ trace, handle }) => ({
      sequence: trace.sequence,
      time,
      visible: true,
      geometry: this.runtime.render(handle, camera, { binary: true }),
    }));
  }
  hidden(time) {
    return this.parents.map(({ trace }) => ({
      sequence: trace.sequence,
      time,
      visible: false,
    }));
  }
  sample(time, camera) {
    this.check();
    assertParentCamera(camera);
    if (!Number.isFinite(time) || !Number.isFinite(Math.fround(time)))
      throw Error("Parent timeline requires a finite float32 time");
    time = Math.fround(time);
    if (time < this.startTime)
      return {
        time,
        camera: structuredClone(camera),
        parents: this.hidden(time),
        beforeBirth: true,
        canonicalSteps: 0,
        fractionalStep: false,
        simulationTime: null,
        nativeCompleteAt: null,
      };
    const saved = time < this.cursor.time ? this.birth : this.cursor;
    // This is a bounded POC work limit, never a fabricated effect expiry.
    if (saved.completeAt === null && time - saved.time > 30)
      throw Error(
        "Parent timeline sample exceeds 30 seconds of unsimulated work",
      );
    // The canonical state is already live after a canonical sample. Restoring
    // megabytes of owned memory is only needed after a fractional sample or seek.
    if (this.liveCanonical !== saved) this.runtime.restore(saved.token);
    const state = { ...saved, stopped: new Set(saved.stopped) };
    let canonicalSteps = 0,
      parents;
    while (state.completeAt === null) {
      const boundary = this.nextBoundary(state);
      if (boundary > time) break;
      parents = this.step(state, boundary, camera);
      canonicalSteps++;
    }
    if (canonicalSteps) {
      const previous = this.cursor;
      this.cursor = {
        ...state,
        stopped: new Set(state.stopped),
        token: this.runtime.checkpoint(),
      };
      if (previous !== this.birth)
        this.runtime.releaseCheckpoint(previous.token);
    }
    const fractionalStep = state.completeAt === null && state.time < time;
    if (state.completeAt !== null) parents = this.hidden(time);
    else if (fractionalStep) parents = this.step(state, time, camera);
    else if (!parents) parents = this.render(time, camera);
    // Rendering touches native scratch/cache memory, so only an actual step
    // whose checkpoint was captured after rendering can remain canonical.
    this.liveCanonical = !fractionalStep && canonicalSteps ? this.cursor : null;
    // A fractional completion is presentation-only. A later sample rediscovers
    // completion on the canonical grid; it cannot mutate the retained cursor.
    return {
      time,
      camera: structuredClone(camera),
      parents,
      beforeBirth: false,
      canonicalSteps,
      fractionalStep,
      simulationTime: state.time,
      nativeCompleteAt: state.completeAt,
    };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.cursor !== this.birth)
      this.runtime.releaseCheckpoint(this.cursor.token);
    this.runtime.releaseCheckpoint(this.birth.token);
  }
}
