import { afterEach, describe, expect, test } from "vitest";
import { resetConfigurationForTests } from "#src/configuration.ts";
import {
  eligibleExploreGuildIds,
  exploreAllowlist,
  exploreGuildCommandGuildIds,
  isExploreAllowed,
  isExploreConfigured,
  isExploreGuildAllowed,
  resolveExploreAccess,
} from "#src/explore/access.ts";

const originalEnvironment = Bun.env["ENVIRONMENT"];

/**
 * Env is mutated directly with `resetConfigurationForTests` rather than
 * the former Bun module mock, which leaked across sibling test files.
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
  if (originalEnvironment === undefined) {
    delete Bun.env["ENVIRONMENT"];
  } else {
    Bun.env["ENVIRONMENT"] = originalEnvironment;
  }
  resetConfigurationForTests();
});

describe("explore access", () => {
  test("an unset allowlist admits nobody", () => {
    Bun.env["ENVIRONMENT"] = "beta";
    withAllowlist(undefined);
    expect(exploreAllowlist()).toEqual([]);
    expect(isExploreConfigured()).toBe(false);
    // The critical direction: no config must not mean no restriction.
    expect(isExploreAllowed([], ["111", "222"])).toBe(false);
  });

  test("an empty or whitespace allowlist also admits nobody", () => {
    Bun.env["ENVIRONMENT"] = "beta";
    withAllowlist("  , ,");
    expect(exploreAllowlist()).toEqual([]);
    expect(isExploreConfigured()).toBe(false);
  });

  test("entries are split and trimmed", () => {
    Bun.env["ENVIRONMENT"] = "beta";
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

  test("returns only guilds eligible for alias resolution", () => {
    expect(eligibleExploreGuildIds(["111", "222"], ["999", "222"])).toEqual([
      "222",
    ]);
  });

  test("production is configured without an allowlist and uses global commands", () => {
    Bun.env["ENVIRONMENT"] = "prod";
    withAllowlist(undefined);

    expect(isExploreConfigured()).toBe(true);
    expect(isExploreGuildAllowed("999")).toBe(true);
    expect(exploreGuildCommandGuildIds()).toEqual([]);
  });

  test("production fails unavailable when connected guilds cannot be verified", () => {
    expect(resolveExploreAccess("prod", [], ["111"], undefined)).toEqual({
      kind: "unavailable",
    });
  });

  test("production requires and returns a shared connected guild", () => {
    expect(resolveExploreAccess("prod", [], ["111", "222"], ["222"])).toEqual({
      kind: "allowed",
      guildIds: ["222"],
    });
    expect(resolveExploreAccess("prod", [], ["111"], ["222"])).toEqual({
      kind: "forbidden",
    });
  });

  test("beta keeps Explore guild-scoped to the allowlist", () => {
    Bun.env["ENVIRONMENT"] = "beta";
    withAllowlist("111,222");

    expect(isExploreGuildAllowed("111")).toBe(true);
    expect(isExploreGuildAllowed("999")).toBe(false);
    expect(exploreGuildCommandGuildIds()).toEqual(["111", "222"]);
  });
});
