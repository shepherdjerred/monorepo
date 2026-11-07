import { expect, test } from "bun:test";
import {
  directRetirementFlags,
  directRemovalFlagTransition,
} from "./latest-direct-effect-retirement.mjs";

test("a queued retirement cannot be changed or enqueued again by a later mode", () => {
  for (const mode of [false, true]) {
    const first = directRetirementFlags(0, mode);
    for (const repeatedMode of [false, true])
      expect(directRetirementFlags(first.flags, repeatedMode)).toEqual({
        flags: first.flags,
        enqueue: false,
      });
  }
});

test("an existing mode-true bit retains precedence over a later reason61 removal", () => {
  const result = directRemovalFlagTransition({
    reasonByte: 61,
    objectFlags: 0x10000000,
    parentFlags: 0,
    effectPresent: true,
  });
  expect(result.mode).toBe(true);
  expect(result.objectFlags).toBe(0x10000800);
  expect(result.entityEffectCleared).toBe(true);
});

test("unknown wrapper and parent values never become lifecycle defaults", () => {
  for (const flags of [undefined, null, -1, 0x10000, 0.5, "0", NaN])
    expect(() => directRetirementFlags(flags, false)).toThrow(
      "unsigned parent flags",
    );
  for (const mode of [undefined, null, 0, 1, "false"])
    expect(() => directRetirementFlags(0, mode)).toThrow("retirement mode");
  const valid = {
    reasonByte: 61,
    objectFlags: 0,
    parentFlags: 0,
    effectPresent: true,
  };
  for (const field of Object.keys(valid))
    expect(() =>
      directRemovalFlagTransition({ ...valid, [field]: undefined }),
    ).toThrow("resolved wrapper inputs");
});
