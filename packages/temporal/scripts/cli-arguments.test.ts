import { describe, expect, test } from "vitest";
import { parseFlagArguments, requiredParsedArgument } from "./cli-arguments.ts";

const FLAGS = new Set(["--build-id", "--target"]);

describe("parseFlagArguments", () => {
  test("parses only declared value flags", () => {
    const parsed = parseFlagArguments(
      ["--target", "scout-beta", "--build-id", "a".repeat(40)],
      FLAGS,
    );

    expect(parsed.get("--target")).toBe("scout-beta");
    expect(requiredParsedArgument(parsed, "--build-id")).toBe("a".repeat(40));
  });

  test("rejects unknown flags instead of falling back to another target", () => {
    expect(() => parseFlagArguments(["--taret", "scout-beta"], FLAGS)).toThrow(
      "Unknown argument --taret",
    );
  });

  test("rejects duplicate flags", () => {
    expect(() =>
      parseFlagArguments(
        ["--target", "central", "--target", "scout-beta"],
        FLAGS,
      ),
    ).toThrow("Duplicate argument --target");
  });

  test("rejects missing flag values", () => {
    expect(() => parseFlagArguments(["--target", "--build-id"], FLAGS)).toThrow(
      "--target requires a value",
    );
  });
});
