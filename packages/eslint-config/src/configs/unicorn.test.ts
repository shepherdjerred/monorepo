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

  test("preserves the reviewed 137-rule policy", () => {
    expect(reviewedUnicornRuleNames).toHaveLength(137);
  });

  test("preserves reviewed rule renames under v72", () => {
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

  test("does not implicitly adopt rules added through the v72 preset", () => {
    const configuredUnicornRuleNames = Object.keys(
      reviewedUnicornConfig.rules ?? {},
    )
      .filter((ruleName) => ruleName.startsWith("unicorn/"))
      .map((ruleName) => ruleName.slice("unicorn/".length))
      .sort();

    expect(configuredUnicornRuleNames).toEqual(
      [...reviewedUnicornRuleNames].sort(),
    );
  });
});
