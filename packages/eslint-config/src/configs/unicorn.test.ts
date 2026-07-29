import { describe, expect, test } from "bun:test";
import unicorn from "eslint-plugin-unicorn";
import { reviewedUnicornConfig, reviewedUnicornRuleNames } from "./unicorn.ts";

describe("reviewed Unicorn policy", () => {
  test("contains only rules implemented by the installed plugin", () => {
    const missingRules = reviewedUnicornRuleNames.filter(
      (ruleName) => unicorn.rules[ruleName] === undefined,
    );

    expect(missingRules).toEqual([]);
  });

  test("preserves the reviewed v64 policy size", () => {
    expect(reviewedUnicornRuleNames).toHaveLength(137);
  });

  test("maps renamed rules to their v69 names", () => {
    expect(reviewedUnicornConfig.rules?.["unicorn/name-replacements"]).toBe(
      "error",
    );
    expect(reviewedUnicornConfig.rules?.["unicorn/no-for-each"]).toBe("error");
    expect(reviewedUnicornConfig.rules?.["unicorn/dom-node-dataset"]).toBe(
      "error",
    );
    expect(
      reviewedUnicornConfig.rules?.[
        "unicorn/prefer-unicode-code-point-escapes"
      ],
    ).toBe("error");
  });

  test("does not implicitly adopt rules added to the v69 preset", () => {
    expect(
      reviewedUnicornConfig.rules?.["unicorn/max-nested-calls"],
    ).toBeUndefined();
    expect(
      reviewedUnicornConfig.rules?.["unicorn/consistent-boolean-name"],
    ).toBeUndefined();
  });
});
