import { afterEach, describe, expect, test } from "bun:test";
import { readPositiveIntegerEnv } from "./env.ts";

const ENV_NAME = "TEMPORAL_TEST_POSITIVE_INTEGER";
const ORIGINAL_VALUE = Bun.env[ENV_NAME];

afterEach(() => {
  Bun.env[ENV_NAME] = ORIGINAL_VALUE;
});

describe("readPositiveIntegerEnv", () => {
  test("returns the default when unset", () => {
    Bun.env[ENV_NAME] = undefined;

    expect(readPositiveIntegerEnv({ name: ENV_NAME, defaultValue: 3 })).toBe(3);
  });

  test("returns a positive integer value from the environment", () => {
    Bun.env[ENV_NAME] = "2";

    expect(readPositiveIntegerEnv({ name: ENV_NAME, defaultValue: 3 })).toBe(2);
  });

  test("rejects invalid environment values", () => {
    Bun.env[ENV_NAME] = "0";

    expect(() =>
      readPositiveIntegerEnv({ name: ENV_NAME, defaultValue: 3 }),
    ).toThrow(`${ENV_NAME} must be a positive integer; got 0`);
  });

  test("rejects decimal environment values", () => {
    Bun.env[ENV_NAME] = "1.0";

    expect(() =>
      readPositiveIntegerEnv({ name: ENV_NAME, defaultValue: 3 }),
    ).toThrow(`${ENV_NAME} must be a positive integer; got 1.0`);
  });

  test("rejects exponent environment values", () => {
    Bun.env[ENV_NAME] = "1e2";

    expect(() =>
      readPositiveIntegerEnv({ name: ENV_NAME, defaultValue: 3 }),
    ).toThrow(`${ENV_NAME} must be a positive integer; got 1e2`);
  });
});
