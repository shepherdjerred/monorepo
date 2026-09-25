import { describe, expect, test } from "vitest";
import { requiredArgument } from "./read-ci-handoff.ts";
import { parseHandoffPayload } from "./write-ci-handoff.ts";

describe("handoff CLI argument handling", () => {
  test("returns the argument at the requested position", () => {
    expect(requiredArgument(["bun", "script", "image-digests"], 2, "key")).toBe(
      "image-digests",
    );
  });

  // A missing key would otherwise read or write the object at `undefined`,
  // which is a silently wrong build-scoped path rather than an error.
  test.each([
    [["bun", "script"], "absent"],
    [["bun", "script", ""], "empty"],
  ])("rejects an %s key", (argumentsList) => {
    expect(() => requiredArgument(argumentsList, 2, "handoff key")).toThrow(
      "handoff key is required",
    );
  });
});

describe("handoff payload validation", () => {
  test("accepts any JSON document the store can hold", () => {
    expect(parseHandoffPayload('{"a":1}', "k")).toEqual({ a: 1 });
    expect(parseHandoffPayload("[1,2]\n", "k")).toEqual([1, 2]);
    expect(parseHandoffPayload('"plain"', "k")).toBe("plain");
  });

  /**
   * Validating in the producing step is the whole point: a producer whose `jq`
   * emitted nothing, or emitted a shell error, must fail there rather than in
   * whichever release step reads it first.
   */
  test("refuses an empty payload", () => {
    expect(() => parseHandoffPayload("   \n", "image-digests")).toThrow(
      "refusing to publish an empty CI handoff for image-digests",
    );
  });

  test("refuses a payload that is not JSON", () => {
    expect(() => parseHandoffPayload("jq: error", "image-digests")).toThrow(
      "CI handoff image-digests is not valid JSON",
    );
  });
});
