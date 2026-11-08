import { describe, expect, test } from "bun:test";
import {
  DirectEffectBackpressureError,
  LatestDirectEffectPresentation,
} from "./latest-direct-effect-presentation.mjs";

const view = (x = 1) => ({ right: [x, 0, 0], up: [0, 1, 0] });
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function control(options) {
  const calls = [];
  const invoke = (type, time, camera) =>
    new Promise((resolve, reject) =>
      calls.push({ type, time, camera, resolve, reject }),
    );
  const client = {
    frame: (time, camera) => invoke("advance", time, camera),
    camera: (camera) => invoke("camera", null, camera),
  };
  return {
    calls,
    presentation: new LatestDirectEffectPresentation(client, options),
  };
}
const finish = (call, time = call.time) => call.resolve({ time, draws: [] });

describe("direct effect presentation ownership", () => {
  test("live ownership rejects stale fulfilled results and foreign matching request IDs", async () => {
    const a = control(),
      b = control();
    const first = a.presentation.sample(0, view());
    const foreign = b.presentation.sample(0, view());
    finish(a.calls[0]);
    finish(b.calls[0]);
    const result = await first,
      foreignResult = await foreign;
    expect(a.presentation.isCurrent(result)).toBe(true);
    expect(a.presentation.isCurrent(foreignResult)).toBe(false);
    expect(a.presentation.isCurrent({ ...result })).toBe(false);
    const later = a.presentation.camera(view(2));
    expect(result.presentable).toBe(true);
    expect(a.presentation.isCurrent(result)).toBe(false);
    finish(a.calls[1], 0);
    expect(a.presentation.isCurrent(await later)).toBe(true);
    a.presentation.close();
    expect(a.presentation.isCurrent(result)).toBe(false);
  });

  test("initial time zero advances events before unchanged-time camera-only sampling", async () => {
    const { calls, presentation } = control();
    const first = presentation.sample(0, view());
    const second = presentation.sample(0, view(2));
    expect(calls[0].type).toBe("advance");
    finish(calls[0]);
    await flush();
    expect(calls[1].type).toBe("camera");
    finish(calls[1], 0);
    expect((await first).presentable).toBe(false);
    expect((await second).presentable).toBe(true);
  });

  test("all accepted advances execute in order, including backward and repeated seeks", async () => {
    const { calls, presentation } = control({ maximumAdvances: 4 });
    const results = [4, 2, 2, 9].map((time) =>
      presentation.advance(time, view()),
    );
    expect(calls.map((call) => call.time)).toEqual([4]);
    for (let index = 0; index < results.length; index++) {
      finish(calls[index]);
      await flush();
    }
    expect(calls.map((call) => call.time)).toEqual([4, 2, 2, 9]);
    const completed = await Promise.all(results);
    expect(completed.map((result) => result.status)).toEqual(
      Array(4).fill("ready"),
    );
    expect(completed.map((result) => result.presentable)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  test("only adjacent queued camera draws supersede; simulation boundaries remain", async () => {
    const { calls, presentation } = control();
    const advance = presentation.advance(4, view());
    const oldCamera = presentation.camera(view(2));
    const newCamera = presentation.camera(view(3));
    const seek = presentation.advance(2, view());
    const afterSeekCamera = presentation.camera(view(4));
    expect(await oldCamera).toEqual({
      status: "superseded",
      requestId: 2,
      supersededBy: 3,
      time: 4,
      presentable: false,
    });
    finish(calls[0]);
    await flush();
    expect(calls[1].type).toBe("camera");
    finish(calls[1], 4);
    await flush();
    finish(calls[2]);
    await flush();
    expect(calls[3].type).toBe("camera");
    finish(calls[3], 2);
    const complete = await Promise.all([
      advance,
      newCamera,
      seek,
      afterSeekCamera,
    ]);
    expect(complete.map((result) => result.operation)).toEqual([
      "advance",
      "camera",
      "advance",
      "camera",
    ]);
    expect(complete.map((result) => result.time)).toEqual([4, 4, 2, 2]);
    expect(complete.at(-1).presentable).toBe(true);
  });

  test("backpressure rejects explicitly without changing accepted time or intent", async () => {
    const { calls, presentation } = control({ maximumAdvances: 1 });
    const accepted = presentation.advance(4, view());
    await expect(presentation.advance(8, view())).rejects.toBeInstanceOf(
      DirectEffectBackpressureError,
    );
    finish(calls[0]);
    expect((await accepted).presentable).toBe(true);
    const camera = presentation.camera(view());
    finish(calls[1], 4);
    expect((await camera).time).toBe(4);
    expect(calls).toHaveLength(2);
  });

  test("camera inputs are snapshotted before asynchronous worker delivery", async () => {
    const { calls, presentation } = control();
    const camera = view();
    const request = presentation.advance(3, camera);
    camera.right[0] = 999;
    expect(calls[0].camera.right[0]).toBe(1);
    finish(calls[0]);
    expect((await request).camera.right[0]).toBe(1);
  });

  test("close aborts active and queued requests and suppresses late packets", async () => {
    const { calls, presentation } = control();
    const active = presentation.advance(3, view());
    const queued = presentation.advance(4, view());
    const aborted = Promise.all([
      active.catch((error) => error),
      queued.catch((error) => error),
    ]);
    presentation.close();
    expect((await aborted).map((error) => error.name)).toEqual([
      "AbortError",
      "AbortError",
    ]);
    finish(calls[0]);
    await flush();
    expect(calls).toHaveLength(1);
    await expect(presentation.camera(view())).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  test("incorrect worker time fails the coordinator and queued requests", async () => {
    const { calls, presentation } = control();
    const active = presentation.advance(3, view());
    const queued = presentation.advance(4, view());
    const rejected = Promise.all([
      active.catch((error) => error),
      queued.catch((error) => error),
    ]);
    finish(calls[0], 2);
    expect((await rejected).map((error) => error.message)).toEqual(
      Array(2).fill(
        "Direct presentation packet differs from its ordered request",
      ),
    );
    expect(calls).toHaveLength(1);
  });
});

test("a branded epoch claim survives the next ordinary intent but cannot be forged, reused or cross-owned", async () => {
  const a = control(),
    b = control();
  const pending = a.presentation.sample(1, view());
  finish(a.calls[0]);
  const first = await pending;
  const claim = a.presentation.claimCurrent(first, 3);
  expect(a.presentation.isClaimCurrent({ ...claim }, 3)).toBe(false);
  expect(b.presentation.isClaimCurrent(claim, 3)).toBe(false);
  expect(a.presentation.isClaimCurrent(claim, 4)).toBe(false);
  expect(() => a.presentation.claimCurrent(first, 3)).toThrow();
  const next = a.presentation.sample(2, view());
  expect(a.presentation.isCurrent(first)).toBe(false);
  expect(a.presentation.isClaimCurrent(claim, 3)).toBe(true);
  a.presentation.releaseClaim(claim);
  expect(() => a.presentation.releaseClaim(claim)).toThrow();
  expect(() => a.presentation.releaseClaim(null)).toThrow();
  finish(a.calls[1]);
  await next;
});
