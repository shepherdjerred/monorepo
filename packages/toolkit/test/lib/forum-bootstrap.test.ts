import { describe, expect, test } from "vitest";
import { parseForumSeed } from "#lib/forum/bootstrap.ts";

describe("forum bootstrap response boundary", () => {
  const key = "a_-".repeat(20);
  const seed = { forums: { findings: 4 }, keys: { codex_key: key } };

  test("accepts the validated bootstrap response", () => {
    expect(parseForumSeed(JSON.stringify(seed))).toEqual(seed);
  });

  test.each([
    `PHP warning\n${JSON.stringify(seed)}`,
    JSON.stringify(seed).slice(0, -1),
    JSON.stringify({ ...seed, forums: { findings: "invalid" } }),
  ])("withholds credential-bearing invalid output: %s", (output) => {
    expect(() => parseForumSeed(output)).toThrow(
      new Error(
        "Invalid response from XenForo bootstrap; output withheld because it may contain credentials",
      ),
    );
  });
});
