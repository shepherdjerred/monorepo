import { expect, test } from "vitest";
import { GoalControlGate } from "./goal-control-gate.ts";

test("GoalControlGate rejects stale goals and drains accepted controls", async () => {
  const gate = new GoalControlGate();
  gate.open("goal-a");
  expect(gate.begin("goal-b")).toBeUndefined();
  const finish = gate.begin("goal-a");
  expect(typeof finish).toBe("function");
  if (finish === undefined) {
    throw new Error("active goal control must be accepted");
  }

  gate.close("goal-a");
  expect(gate.begin("goal-a")).toBeUndefined();
  let drained = false;
  const drain = (async () => {
    await gate.drain();
    drained = true;
  })();
  await Bun.sleep(0);
  expect(drained).toBe(false);

  finish();
  finish();
  await drain;
  expect(drained).toBe(true);

  gate.open("goal-b");
  expect(gate.begin("goal-a")).toBeUndefined();
  const finishNext = gate.begin("goal-b");
  expect(typeof finishNext).toBe("function");
  finishNext?.();
  gate.close("goal-b");
});
