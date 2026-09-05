import { describe, expect, test } from "vitest";
import { z } from "zod";
import { parseShowcaseCliValues } from "./showcase-cli.ts";

const FlagNameSchema = z.enum(["bucket", "out"]);

describe("parseShowcaseCliValues", () => {
  test("parses separated and equals-form values", () => {
    expect(
      parseShowcaseCliValues(
        ["--bucket", "scout", "--out=generated"],
        FlagNameSchema,
      ),
    ).toEqual({ bucket: "scout", out: "generated" });
  });

  test.each([
    { args: ["output"], message: "Unexpected positional argument" },
    { args: ["--unknown", "value"], message: "Invalid option" },
    { args: ["--bucket", "one", "--bucket", "two"], message: "Duplicate" },
    { args: ["--bucket"], message: "Missing value" },
    { args: ["--bucket="], message: "Missing value" },
  ])("rejects invalid arguments: $message", ({ args, message }) => {
    expect(() => parseShowcaseCliValues(args, FlagNameSchema)).toThrow(message);
  });
});
