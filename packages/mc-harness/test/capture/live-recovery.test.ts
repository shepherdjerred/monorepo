import { expect, it } from "vitest";
import { recoveryInteraction } from "#daemon/capture-recovery.ts";
import { ClientStateSchema } from "#protocol/client.ts";
import { CaptureBoundedActionSchema } from "#protocol/capture.ts";
import { connectedState } from "#test/fake-client.ts";

const box = {
  world: "world",
  min: { x: -2, y: -64, z: -2 },
  max: { x: 5, y: 0, z: 5 },
};
const id = "capture-00000000-0000-4000-8000-000000000001";
function fixture() {
  const run: Parameters<typeof recoveryInteraction>[0] = {
    id,
    target: "live",
    name: "XiguaJerred",
    state: "needs-recovery",
    box,
    cleanup: [
      { kind: "break", position: [0, -61, 2], standing: [0.5, -60, 0.5] },
    ],
  };
  const state = ClientStateSchema.parse(connectedState(0, 0));
  const operation = CaptureBoundedActionSchema.parse({
    box,
    recovery: id,
    action: "attack",
    arguments: {},
  });
  return { run, state, operation };
}

it("permits only the saved stationary cleanup target and sends an exact native sign guard", () => {
  const { run, state, operation } = fixture();
  expect(recoveryInteraction(run, "XiguaJerred", operation, state)).toEqual({
    expectedWorld: "minecraft:overworld",
    expectedBlock: [0, -61, 2],
  });
  expect(() =>
    recoveryInteraction(run, "SomeoneElse", operation, state),
  ).toThrow("saved live cleanup");
  expect(() =>
    recoveryInteraction(
      { ...run, state: "complete" },
      "XiguaJerred",
      operation,
      state,
    ),
  ).toThrow("saved live cleanup");
  expect(() =>
    recoveryInteraction(
      { ...run, cleanup: [] },
      "XiguaJerred",
      operation,
      state,
    ),
  ).toThrow("saved live cleanup");
  expect(() =>
    recoveryInteraction(
      run,
      "XiguaJerred",
      { ...operation, recovery: "capture-other" },
      state,
    ),
  ).toThrow("saved live cleanup");
});

it("rejects a changed box, target, standing position or held movement", () => {
  const { run, state, operation } = fixture();
  expect(() =>
    recoveryInteraction(
      run,
      "XiguaJerred",
      { ...operation, box: { ...box, max: { ...box.max, x: 6 } } },
      state,
    ),
  ).toThrow();
  for (const change of [
    { target: { kind: "block", position: [1, -61, 2] } },
    { position: [1.5, -60, 0.5] },
    { heldInputs: ["forward"] },
  ])
    expect(() =>
      recoveryInteraction(
        run,
        "XiguaJerred",
        operation,
        ClientStateSchema.parse({ ...connectedState(0, 0), ...change }),
      ),
    ).toThrow();
});

it("permits a short sneak hold but refuses use, moving input and held attack", () => {
  const { run, state, operation } = fixture();
  const sneak = {
    ...operation,
    action: "input" as const,
    arguments: { buttons: ["sneak"], ticks: 40 },
  };
  expect(recoveryInteraction(run, "XiguaJerred", sneak, state)).toEqual(
    sneak.arguments,
  );
  expect(() =>
    recoveryInteraction(
      run,
      "XiguaJerred",
      { ...operation, action: "use" },
      state,
    ),
  ).toThrow();
  for (const buttons of [["forward"], ["attack"], ["sneak", "use"]])
    expect(() =>
      recoveryInteraction(
        run,
        "XiguaJerred",
        { ...sneak, arguments: { buttons, ticks: 40 } },
        state,
      ),
    ).toThrow();
});
