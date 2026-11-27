import { describe, expect, test } from "vitest";
import {
  createCameraController,
  SETTLE_MS,
  worldTransform,
  type Clock,
  type WorldElement,
} from "./controller.ts";

/** A clock the test steps by hand: frames at 16 ms, timers on the same timeline. */
function fakeClock() {
  let now = 0;
  let nextHandle = 1;
  const frames = new Map<number, (time: number) => void>();
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: Clock = {
    raf(callback) {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelRaf: (handle) => frames.delete(handle),
    setTimer(callback, ms) {
      const handle = nextHandle++;
      timers.set(handle, { at: now + ms, run: callback });
      return handle;
    },
    clearTimer: (handle) => timers.delete(handle),
  };
  return {
    clock,
    /** Advances `ms`, running one animation frame every 16 ms and due timers. */
    advance(ms: number) {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + 16);
        const due = [...timers].filter(([, timer]) => timer.at <= now);
        for (const [handle, timer] of due) {
          timers.delete(handle);
          timer.run();
        }
        // Callbacks schedule the next frame, so take the queue first.
        const queued = [...frames.values()];
        frames.clear();
        for (const callback of queued) callback(now);
      }
    },
    pending: () => ({ frames: frames.size, timers: timers.size }),
  };
}

function worldElement(): WorldElement & { writes: string[] } {
  const writes: string[] = [];
  let transform = "";
  return {
    writes,
    style: {
      get transform() {
        return transform;
      },
      set transform(value: string) {
        transform = value;
        writes.push(value);
      },
      willChange: "",
    },
  };
}

describe("camera controller", () => {
  test("writes the transform once per frame however many moves arrive", () => {
    const time = fakeClock();
    const controller = createCameraController({ x: 0, y: 0, s: 1 }, time.clock);
    const world = worldElement();
    controller.attach(world);
    world.writes.length = 0;
    for (let move = 1; move <= 5; move += 1)
      controller.moveTo({ x: move * 10, y: 0, s: 1 }, "pan");
    time.advance(16);
    expect(world.writes).toEqual([worldTransform({ x: 50, y: 0, s: 1 })]);
  });

  test("will-change is on only while the camera moves", () => {
    const time = fakeClock();
    const controller = createCameraController({ x: 0, y: 0, s: 1 }, time.clock);
    const world = worldElement();
    controller.attach(world);
    expect(world.style.willChange).toBe("auto");
    controller.moveTo({ x: 5, y: 0, s: 1 }, "pan");
    expect(world.style.willChange).toBe("transform");
    time.advance(SETTLE_MS.pan + 32);
    expect(world.style.willChange).toBe("auto");
    expect(controller.isMoving()).toBe(false);
  });

  test("settles after 120 ms for a pan and 250 ms for a zoom", () => {
    const time = fakeClock();
    const controller = createCameraController({ x: 0, y: 0, s: 1 }, time.clock);
    const settled: string[] = [];
    controller.onSettle((_camera, info) => settled.push(info.kind));
    controller.moveTo({ x: 5, y: 0, s: 1 }, "pan");
    time.advance(SETTLE_MS.pan - 16);
    expect(settled).toEqual([]);
    time.advance(32);
    expect(settled).toEqual(["pan"]);
    controller.moveTo({ x: 5, y: 0, s: 2 }, "zoom");
    time.advance(SETTLE_MS.pan + 32);
    expect(settled).toEqual(["pan"]);
    time.advance(SETTLE_MS.zoom);
    expect(settled).toEqual(["pan", "zoom"]);
  });

  test("a new move restarts the settle timer", () => {
    const time = fakeClock();
    const controller = createCameraController({ x: 0, y: 0, s: 1 }, time.clock);
    let settles = 0;
    controller.onSettle(() => {
      settles += 1;
    });
    for (let step = 0; step < 10; step += 1) {
      controller.moveTo({ x: step, y: 0, s: 1 }, "pan");
      time.advance(80);
    }
    expect(settles).toBe(0);
    time.advance(200);
    expect(settles).toBe(1);
  });

  test("reports the frames drawn during the motion and then stops the loop", () => {
    const time = fakeClock();
    const controller = createCameraController({ x: 0, y: 0, s: 1 }, time.clock);
    let times: readonly number[] = [];
    controller.onSettle((_camera, info) => {
      times = info.frameTimes;
    });
    controller.moveTo({ x: 1, y: 0, s: 1 }, "pan");
    time.advance(SETTLE_MS.pan + 64);
    expect(times.length).toBeGreaterThanOrEqual(7);
    expect(time.pending()).toEqual({ frames: 0, timers: 0 });
  });

  test("frame listeners follow every written frame and the settle", () => {
    const time = fakeClock();
    const controller = createCameraController({ x: 0, y: 0, s: 1 }, time.clock);
    const seen: number[] = [];
    const off = controller.onFrame((camera) => seen.push(camera.x));
    controller.moveTo({ x: 10, y: 0, s: 1 }, "pan");
    time.advance(16);
    controller.moveTo({ x: 20, y: 0, s: 1 }, "pan");
    time.advance(16);
    expect(seen.slice(0, 2)).toEqual([10, 20]);
    off();
    controller.moveTo({ x: 30, y: 0, s: 1 }, "pan");
    time.advance(400);
    expect(seen.at(-1)).toBe(20);
  });

  test("detaching cancels the pending frame and timer", () => {
    const time = fakeClock();
    const controller = createCameraController({ x: 0, y: 0, s: 1 }, time.clock);
    const detach = controller.attach(worldElement());
    controller.moveTo({ x: 1, y: 1, s: 1 }, "zoom");
    detach();
    expect(time.pending()).toEqual({ frames: 0, timers: 0 });
  });
});
