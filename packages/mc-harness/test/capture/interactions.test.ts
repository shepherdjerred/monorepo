import { it, expect } from "vitest";
import { createInteractions } from "#src/capture/interactions.ts";

it("releases native input when pose verification or input admission fails", async () => {
  const calls: string[] = [];
  const interact = createInteractions({
    status: () =>
      Promise.resolve({
        connected: true,
        position: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        health: 20,
        food: 20,
        world: "world",
        hotbar: 0,
        screen: "",
        target: { kind: "block", hit: [0, 0, 0] },
        fps: 60,
        heldInputs: [],
        pid: 1,
        inventory: [],
      }),
    lookAt: () => Promise.resolve(),
    mark: () => Promise.resolve(),
    bounded: (action) => {
      calls.push(action);
      return Promise.reject(new Error("Fixture admission refused"));
    },
    native: (action) => {
      calls.push(action);
      return Promise.resolve();
    },
    waitFor: async (_, predicate) => {
      await Bun.sleep(0);
      predicate({ connected: false, screen: "" });
      throw new Error("Pose was not verified");
    },
  });
  await expect(interact("use", true)).rejects.toThrow(
    "Fixture admission refused",
  );
  expect(calls).toEqual(["input", "release-inputs"]);
});
