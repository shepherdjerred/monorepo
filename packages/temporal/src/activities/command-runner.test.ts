import { describe, expect, test } from "vitest";
import { captureCommand, mergeCommandEnvironment } from "./command-runner.ts";

describe("mergeCommandEnvironment", () => {
  test("inherits, overrides, adds, and explicitly clears variables", () => {
    expect(
      mergeCommandEnvironment(
        { INHERITED: "kept", OVERRIDDEN: "old", CLEARED: "secret" },
        { OVERRIDDEN: "new", ADDED: "value", CLEARED: undefined },
      ),
    ).toEqual({
      INHERITED: "kept",
      OVERRIDDEN: "new",
      ADDED: "value",
    });
  });
});

describe("captureCommand", () => {
  test("returns raw output and a nonzero exit code to the caller", async () => {
    const result = await captureCommand(
      [
        "bun",
        "-e",
        String.raw`process.stdout.write(process.env.COMMAND_VALUE ?? ""); process.stderr.write("problem\n"); process.exit(7)`,
      ],
      { cwd: "/tmp", env: { COMMAND_VALUE: "raw output\n" } },
    );

    expect(result).toEqual({
      stdout: "raw output\n",
      stderr: "problem\n",
      exitCode: 7,
    });
  });
});
