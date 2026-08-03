import { describe, expect, test } from "bun:test";

import { argumentValue } from "#lib/cli.ts";

describe("argumentValue", () => {
  test("returns undefined when the option is absent", () => {
    expect(argumentValue("--database", ["bun", "script.ts"])).toBeUndefined();
  });

  test("rejects a trailing option without a value", () => {
    expect(() =>
      argumentValue("--database", ["bun", "script.ts", "--database"]),
    ).toThrow("Option --database requires a value");
  });

  test("rejects another option as the value", () => {
    expect(() =>
      argumentValue("--database", [
        "bun",
        "script.ts",
        "--database",
        "--input",
        "dataset.json",
      ]),
    ).toThrow("Option --database requires a value");
  });

  test("returns a valid option value", () => {
    expect(
      argumentValue("--database", [
        "bun",
        "script.ts",
        "--database",
        "./evals.sqlite",
        "--input",
        "dataset.json",
      ]),
    ).toBe("./evals.sqlite");
  });
});
