import { test, expect } from "bun:test";
import { Vector3 } from "../../../../.cache/replay-spike/public/vendor/three.core.js";
import { LatestDirectEffectPresentation } from "./latest-direct-effect-presentation.mjs";
import {
  LatestDirectCaptureOwnership,
  requestDirectFrameBeforeWorld,
  isCurrentDirectViewerFrame,
  applyViewerFollowTranslation,
  sampleViewerFollowPosition,
  captureSynchronizedDirectView,
} from "./latest-viewer-frame-coordination.mjs";

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const view = () => ({ right: [1, 0, 0], up: [0, 1, 0] });
function coordinator() {
  const calls = [];
  const invoke = (time, camera) =>
    new Promise((resolve, reject) =>
      calls.push({ time, camera, resolve, reject }),
    );
  const presentation = new LatestDirectEffectPresentation({
    frame: invoke,
    camera: (camera) => invoke(3, camera),
  });
  return { calls, presentation };
}

test("paused capture owns actual presentation intent despite a previously pending RAF", async () => {
  const lock = new LatestDirectCaptureOwnership(),
    { calls, presentation } = coordinator();
  const ordinary = presentation.sample(3, view());
  const token = lock.acquire();
  const capture = presentation.sample(3, view());
  expect(lock.blocksOrdinary(false)).toBe(true);
  expect(() => lock.acquire()).toThrow("already active");
  // A paused RAF must not enqueue another camera request or commit its old result.
  if (!lock.blocksOrdinary(false)) presentation.sample(3, view());
  calls[0].resolve({ time: 3, draws: [] });
  await flush();
  expect(presentation.isCurrent(await ordinary)).toBe(false);
  expect(lock.blocksOrdinary(false)).toBe(true);
  expect(calls).toHaveLength(2);
  calls[1].resolve({ time: 3, draws: [] });
  const captured = await capture;
  expect(presentation.isCurrent(captured)).toBe(true);
  expect(lock.owns(token)).toBe(true);
  lock.release(token);
  expect(lock.blocksOrdinary(false)).toBe(false);
});

test("Play invalidates capture ownership permanently, while foreign release cannot unlock capture", () => {
  const lock = new LatestDirectCaptureOwnership(),
    token = lock.acquire();
  lock.release({});
  expect(lock.owns(token)).toBe(true);
  expect(lock.blocksOrdinary(true)).toBe(false);
  expect(lock.owns(token)).toBe(false);
  expect(lock.blocksOrdinary(false)).toBe(false);
  const later = lock.acquire();
  lock.release(token);
  expect(lock.owns(later)).toBe(true);
  lock.release(later);
});

test("worker request starts before world/HUD and retains the exact new-time follow snapshot", async () => {
  const order = [],
    camera = { position: new Vector3(0, 100, 200) },
    controls = { target: new Vector3(0, 0, 0) };
  let finish;
  const task = requestDirectFrameBeforeWorld({
    time: 69.5,
    captureView() {
      order.push("follow-camera");
      // Both hero-root and minion lifecycle samplers provide this desired-time point.
      applyViewerFollowTranslation(camera, controls, [20, 7, 40]);
      return { position: camera.position.clone() };
    },
    requestPresentation(time, captured) {
      order.push("post");
      expect(time).toBe(69.5);
      expect(captured.position.toArray()).toEqual([20, 107, 160]);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    updateWorld() {
      order.push("world");
      camera.position.set(999, 999, 999);
    },
  });
  expect(order).toEqual(["follow-camera", "post", "world"]);
  finish({ time: 69.5 });
  const result = await task;
  expect(result.view.position.toArray()).toEqual([20, 107, 160]);
  expect(result.presentation.time).toBe(69.5);
  expect(controls.target.toArray()).toEqual([20, 7, -40]);
});

test("follow death/disappearance and switching while waiting invalidate the old follow frame", async () => {
  const { calls, presentation } = coordinator();
  const pending = presentation.sample(3, view());
  calls[0].resolve({ time: 3, draws: [] });
  const result = await pending,
    report = {},
    follow = { entityId: 7 },
    session = {
      isPresentationCurrent: (value) => presentation.isCurrent(value),
    };
  const inputs = {
    capturedReport: report,
    capturedSession: session,
    presentation: result,
    viewAspect: 16 / 9,
    capturedFollow: follow,
    report,
    session,
    time: 3,
    aspect: 16 / 9,
    follow,
  };
  expect(isCurrentDirectViewerFrame(inputs)).toBe(true);
  for (const changed of [
    { follow: null },
    { follow: { entityId: 8 } },
    { report: {} },
    { session: { isPresentationCurrent: () => true } },
    { time: 2 },
    { aspect: 1 },
  ]) {
    expect(isCurrentDirectViewerFrame({ ...inputs, ...changed })).toBe(false);
  }
  const seek = presentation.advance(2, view());
  expect(isCurrentDirectViewerFrame(inputs)).toBe(false);
  calls[1].resolve({ time: 2, draws: [] });
  await seek;
  expect(isCurrentDirectViewerFrame(inputs)).toBe(false);
});

test("world failure remains explicit and accepted worker failure is observed", async () => {
  let rejectWorker;
  await expect(
    requestDirectFrameBeforeWorld({
      time: 3,
      captureView: view,
      requestPresentation: () =>
        new Promise((_, reject) => {
          rejectWorker = reject;
        }),
      updateWorld: () => {
        throw Error("world failure");
      },
    }),
  ).rejects.toThrow("world failure");
  rejectWorker(Error("worker failure"));
  await flush();
  await expect(
    requestDirectFrameBeforeWorld({
      time: 3,
      captureView: view,
      requestPresentation: () => Promise.reject(Error("worker failure")),
      updateWorld() {},
    }),
  ).rejects.toThrow("worker failure");
});

test("follow samples desired-time actor and minion corpse boundaries instead of old display position", () => {
  const hero = {
      hero: { entityId: 1 },
      group: { visible: true, position: [999, 999, 999] },
    },
    minion = {
      event: { entityId: 2 },
      group: { visible: true, position: [999, 999, 999] },
    };
  const queries = [],
    samplers = {
      sampleHero(entry, at) {
        queries.push([entry, at]);
        return [at, 7, 8];
      },
      sampleMinion(entry, at) {
        queries.push([entry, at]);
        return { visible: at < 70, position: [at, 4, 5] };
      },
    };
  expect(sampleViewerFollowPosition(hero, 69, samplers)).toEqual([69, 7, 8]);
  expect(sampleViewerFollowPosition(minion, 69.99, samplers)).toEqual([
    69.99, 4, 5,
  ]);
  expect(sampleViewerFollowPosition(minion, 70, samplers)).toBeNull();
  // Seeking backward restores the causal point, regardless of stale display visibility.
  minion.group.visible = false;
  expect(sampleViewerFollowPosition(minion, 69, samplers)).toEqual([69, 4, 5]);
  hero.group.visible = false;
  expect(sampleViewerFollowPosition(hero, 69, samplers)).toBeNull();
  expect(queries.map((q) => q[1])).toEqual([69, 69.99, 70, 69]);
});

test("explicit capture synchronizes world and follow before cloning camera or requesting worker", () => {
  const ownership = new LatestDirectCaptureOwnership(),
    token = ownership.acquire(),
    order = [];
  const camera = { position: new Vector3(0, 100, 200) },
    controls = { target: new Vector3(0, 0, 0) };
  let worldTime = 74;
  const view = captureSynchronizedDirectView({
    updateWorld() {
      expect(ownership.owns(token)).toBe(true);
      order.push("world-HUD-follow");
      worldTime = 82.35;
      applyViewerFollowTranslation(camera, controls, [82.35, 7, 40]);
    },
    captureView() {
      order.push("camera");
      expect(worldTime).toBe(82.35);
      return camera.position.clone();
    },
  });
  order.push("worker-request");
  expect(order).toEqual(["world-HUD-follow", "camera", "worker-request"]);
  expect(view.toArray()).toEqual([82.35, 107, 160]);
  expect(ownership.owns(token)).toBe(true);
  ownership.release(token);
  let cloned = false;
  expect(() =>
    captureSynchronizedDirectView({
      updateWorld() {
        throw Error("world failure");
      },
      captureView() {
        cloned = true;
      },
    }),
  ).toThrow("world failure");
  expect(cloned).toBe(false);
});

test("minion missing-state preview restores loaded root before movement or attack overrides across seeks", async () => {
  const THREE =
    await import("../../../../.cache/replay-spike/public/vendor/three.core.js");
  const { restoreViewerMinionBindPreview } =
    await import("./latest-viewer-frame-coordination.mjs");
  const group = new THREE.Group();
  group.rotation.y = 0.25;
  const entry = { group, bindRootQuaternion: group.quaternion.clone() };
  const present = (stateYaw) => {
    restoreViewerMinionBindPreview(entry);
    if (stateYaw !== null) group.rotation.y = stateYaw;
    group.updateMatrix();
    return group.matrix.toArray();
  };
  const first = present(null);
  present(2);
  present(-1);
  expect(present(null)).toEqual(first);
  expect(present(0.7)).not.toEqual(first);
  expect(present(null)).toEqual(first);
});

test("owned follow controls acknowledgement is exact, one-use, and never covers external mutation", async () => {
  const { LatestOwnedFollowCameraUpdate } =
    await import("./latest-viewer-frame-coordination.mjs");
  const own = new LatestOwnedFollowCameraUpdate();
  own.mark("follow-matrix");
  expect(own.consume("external-matrix", false)).toBe(false);
  expect(own.consume("follow-matrix", false)).toBe(false);
  own.mark("follow-matrix");
  expect(own.consume("follow-matrix", true)).toBe(false);
  own.mark("follow-matrix");
  expect(own.consume("follow-matrix", false)).toBe(true);
  expect(own.consume("follow-matrix", false)).toBe(false);
  own.mark("next-follow");
  expect(own.consume("post-marker-user-change", false)).toBe(false);
});
