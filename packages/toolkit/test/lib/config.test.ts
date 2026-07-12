import { afterEach, describe, expect, it } from "bun:test";
import { optionalEnv, requireEnv } from "#lib/config.ts";

const TEST_VAR = "TOOLKIT_CONFIG_TEST_VAR";
const ORIGINAL = Bun.env[TEST_VAR];

afterEach(() => {
  if (ORIGINAL === undefined) {
    Reflect.deleteProperty(Bun.env, TEST_VAR);
  } else {
    Bun.env[TEST_VAR] = ORIGINAL;
  }
});

describe("requireEnv", () => {
  it("returns the value when the variable is set", () => {
    Bun.env[TEST_VAR] = "value";
    expect(requireEnv(TEST_VAR, "the test variable")).toBe("value");
  });

  it("throws an actionable error naming the variable and description when unset", () => {
    Reflect.deleteProperty(Bun.env, TEST_VAR);
    expect(() => requireEnv(TEST_VAR, "the test variable")).toThrow(
      `${TEST_VAR} environment variable is not set (the test variable). Set ${TEST_VAR} in your environment and try again.`,
    );
  });

  it("treats an empty string as unset", () => {
    Bun.env[TEST_VAR] = "";
    expect(() => requireEnv(TEST_VAR, "the test variable")).toThrow(
      `${TEST_VAR} environment variable is not set`,
    );
  });
});

describe("optionalEnv", () => {
  it("returns the value when set", () => {
    Bun.env[TEST_VAR] = "present";
    expect(optionalEnv(TEST_VAR)).toBe("present");
  });

  it("returns undefined when unset", () => {
    Reflect.deleteProperty(Bun.env, TEST_VAR);
    expect(optionalEnv(TEST_VAR)).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    Bun.env[TEST_VAR] = "";
    expect(optionalEnv(TEST_VAR)).toBeUndefined();
  });
});
