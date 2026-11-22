import { describe, expect, test } from "vitest";
import {
  booleanPresence,
  evaluateBoolean,
  evaluateNumber,
  evaluateString,
  type FlagValue,
} from "./evaluate.ts";

const flags = [
  { type: "boolean", key: "plain-on", default: true, rollouts: [] },
  { type: "boolean", key: "plain-off", default: false, rollouts: [] },
  {
    type: "boolean",
    key: "owner-then-server",
    default: false,
    rollouts: [
      {
        constraints: [{ property: "user", value: "owner" }],
        result: true,
      },
      {
        constraints: [{ property: "server", value: "guild-1" }],
        result: true,
      },
    ],
  },
  {
    type: "boolean",
    key: "beta-stage",
    default: false,
    rollouts: [
      {
        constraints: [
          { property: "stage", value: "beta" },
          { property: "environment", value: "beta" },
        ],
        result: true,
      },
    ],
  },
  { type: "variant", key: "model", value: "gpt-6-luna" },
  { type: "variant", key: "budget", value: "40" },
  { type: "variant", key: "label", value: "soon" },
] as const satisfies readonly FlagValue[];

describe("evaluateBoolean", () => {
  test("returns a constant default", () => {
    expect(evaluateBoolean(flags, "plain-on", {})).toEqual({
      kind: "value",
      value: true,
    });
    expect(evaluateBoolean(flags, "plain-off", {})).toEqual({
      kind: "value",
      value: false,
    });
  });

  test("takes the first matching segment", () => {
    expect(
      evaluateBoolean(flags, "owner-then-server", {
        user: "owner",
        server: "guild-1",
      }),
    ).toEqual({ kind: "value", value: true });
    expect(
      evaluateBoolean(flags, "owner-then-server", { server: "guild-1" }),
    ).toEqual({ kind: "value", value: true });
  });

  test("a missing property does not match, and a miss uses the default", () => {
    expect(
      evaluateBoolean(flags, "owner-then-server", { user: "someone-else" }),
    ).toEqual({ kind: "value", value: false });
    expect(evaluateBoolean(flags, "beta-stage", { stage: "beta" })).toEqual({
      kind: "value",
      value: false,
    });
  });

  test("requires every constraint", () => {
    expect(
      evaluateBoolean(flags, "beta-stage", {
        stage: "beta",
        environment: "beta",
      }),
    ).toEqual({ kind: "value", value: true });
  });

  test("a missing key is absent", () => {
    expect(evaluateBoolean(flags, "nope", {})).toEqual({ kind: "missing" });
  });

  test("a variant key is a type mismatch", () => {
    expect(evaluateBoolean(flags, "model", {}).kind).toBe("type-mismatch");
  });

  test("an empty segment is a broken declaration", () => {
    expect(() =>
      evaluateBoolean(
        [
          {
            type: "boolean",
            key: "open",
            default: false,
            rollouts: [{ constraints: [], result: true }],
          },
        ],
        "open",
        {},
      ),
    ).toThrow(/no constraints/);
  });
});

describe("evaluateString and evaluateNumber", () => {
  test("returns the variant string", () => {
    expect(evaluateString(flags, "model")).toEqual({
      kind: "value",
      value: "gpt-6-luna",
    });
  });

  test("parses a finite number and rejects anything else", () => {
    expect(evaluateNumber(flags, "budget")).toEqual({
      kind: "value",
      value: 40,
    });
    expect(evaluateNumber(flags, "label")).toEqual({
      kind: "invalid",
      message: 'variant "soon" for flag "label" is not a number',
    });
    expect(
      evaluateNumber(
        [{ type: "variant", key: "blank", value: "   " }],
        "blank",
      ),
    ).toEqual({
      kind: "invalid",
      message: 'variant "   " for flag "blank" is not a number',
    });
  });

  test("a boolean key is a type mismatch and a missing key stays missing", () => {
    expect(evaluateString(flags, "plain-on").kind).toBe("type-mismatch");
    expect(evaluateNumber(flags, "nope")).toEqual({ kind: "missing" });
  });
});

describe("booleanPresence", () => {
  test("uses the default when there is no rollout", () => {
    expect(booleanPresence(flags[0])).toBe("on");
    expect(booleanPresence(flags[1])).toBe("off");
  });

  test("a segment makes the flag targeted", () => {
    expect(booleanPresence(flags[2])).toBe("targeted");
  });
});
