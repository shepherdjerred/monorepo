import { afterEach, describe, expect, test } from "bun:test";
import { resetConfigurationForTests } from "#src/configuration.ts";
import {
  exploreAllowlist,
  isExploreAllowed,
  isExploreConfigured,
} from "#src/explore/access.ts";

/**
 * Env is mutated directly with `resetConfigurationForTests` rather than
 * `mock.module`, which leaks across sibling test files in this suite.
 */
function withAllowlist(value: string | undefined): void {
  if (value === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = value;
  }
  resetConfigurationForTests();
}

afterEach(() => {
  withAllowlist(undefined);
});

describe("explore access", () => {
  test("an unset allowlist admits nobody", () => {
    withAllowlist(undefined);
    expect(exploreAllowlist()).toEqual([]);
    expect(isExploreConfigured()).toBe(false);
    // The critical direction: no config must not mean no restriction.
    expect(isExploreAllowed([], ["111", "222"])).toBe(false);
  });

  test("an empty or whitespace allowlist also admits nobody", () => {
    withAllowlist("  , ,");
    expect(exploreAllowlist()).toEqual([]);
    expect(isExploreConfigured()).toBe(false);
  });

  test("entries are split and trimmed", () => {
    withAllowlist(" 111 , 222,333 ");
    expect(exploreAllowlist()).toEqual(["111", "222", "333"]);
    expect(isExploreConfigured()).toBe(true);
  });

  test("membership in any allowlisted server grants access", () => {
    expect(isExploreAllowed(["111", "222"], ["999", "222"])).toBe(true);
  });

  test("membership in no allowlisted server denies access", () => {
    expect(isExploreAllowed(["111", "222"], ["999", "888"])).toBe(false);
    expect(isExploreAllowed(["111"], [])).toBe(false);
  });
});
