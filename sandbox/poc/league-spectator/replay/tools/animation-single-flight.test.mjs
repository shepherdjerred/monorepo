import { expect, test } from "bun:test";
import { createAnimationSingleFlight } from "./animation-single-flight.mjs";
const hash = "a".repeat(64);
test("concurrent source aliases share exactly one complete export", async () => {
  const once = createAnimationSingleFlight();
  let release,
    calls = 0;
  const gate = new Promise((resolve) => (release = resolve)),
    receipt = { sha256: "b".repeat(64) };
  const prepare = async () => {
    calls++;
    await gate;
    return receipt;
  };
  const jobs = Array.from({ length: 10 }, () => once(hash, prepare));
  await Promise.resolve();
  expect(calls).toBe(1);
  release();
  const results = await Promise.all(jobs);
  expect(results.every((value) => value === receipt)).toBe(true);
});
test("an export failure reaches all aliases and leaves no poisoned in-flight entry", async () => {
  const once = createAnimationSingleFlight(),
    failure = Error("Native boundary");
  const jobs = [
    once(hash, () => {
      throw failure;
    }),
    once(hash, () => {
      throw Error("Must not execute alias producer");
    }),
  ];
  const results = await Promise.allSettled(jobs);
  expect(
    results.every(
      (value) => value.status === "rejected" && value.reason === failure,
    ),
  ).toBe(true);
  expect(await once(hash, () => "retry completed")).toBe("retry completed");
});
test("different semantic resource keys do not share native work", async () => {
  const once = createAnimationSingleFlight();
  expect(
    await Promise.all([once(hash, () => 1), once("b".repeat(64), () => 2)]),
  ).toEqual([1, 2]);
  await expect(once("partial-key", () => 1)).rejects.toThrow("Complete");
});
