import { expect, test } from "bun:test";
import { LatestViewerReplayLoad } from "./latest-viewer-replay-load.mjs";

test("world presentation stays blocked until the complete asynchronous load", async () => {
  const load = new LatestViewerReplayLoad(),
    token = load.begin();
  expect(load.loading).toBe(true);
  expect(await load.wait(token, Promise.resolve("heroes"))).toBe("heroes");
  expect(load.loading).toBe(true);
  expect(await load.wait(token, Promise.resolve("effects"))).toBe("effects");
  load.complete(token);
  expect(load.loading).toBe(false);
  expect(load.isCurrent(token)).toBe(true);
});

test("late results and failures from a replaced load cannot own the replacement", async () => {
  const load = new LatestViewerReplayLoad(),
    old = load.begin();
  let resolve;
  const pending = load.wait(
    old,
    new Promise((done) => {
      resolve = done;
    }),
  );
  const replacement = load.begin();
  resolve("old actor");
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(load.isCurrent(old)).toBe(false);
  expect(() => load.complete(old)).toThrow("Replay replaced");
  expect(load.loading).toBe(true);
  expect(load.isCurrent(replacement)).toBe(true);
  load.complete(replacement);
  expect(load.loading).toBe(false);
});

test("failure invalidates in-flight loading work and permits another load", async () => {
  const load = new LatestViewerReplayLoad(),
    token = load.begin();
  let resolve;
  const pending = load.wait(
    token,
    new Promise((done) => {
      resolve = done;
    }),
  );
  load.invalidate();
  resolve("late resource");
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(load.isCurrent(token)).toBe(false);
  expect(load.loading).toBe(false);
  const replacement = load.begin();
  load.complete(replacement);
  expect(load.loading).toBe(false);
});
