import { describe, expect, test } from "vitest";
import {
  eligibleConsumerGuildIds,
  resolveConsumerAccess,
} from "#src/consumer/access.ts";

describe("consumer access", () => {
  test("beta intersects membership with the configured guilds", () => {
    expect(
      resolveConsumerAccess(
        "beta",
        ["guild-a", "guild-b"],
        ["guild-b", "guild-c"],
        undefined,
      ),
    ).toEqual({ kind: "allowed", guildIds: ["guild-b"] });
  });

  test("production intersects membership with the connected bot cache", () => {
    expect(
      resolveConsumerAccess(
        "prod",
        ["ignored-in-production"],
        ["guild-a", "guild-b"],
        ["guild-b", "guild-c"],
      ),
    ).toEqual({ kind: "allowed", guildIds: ["guild-b"] });
  });

  test("an unavailable production cache is not reported as forbidden", () => {
    expect(resolveConsumerAccess("prod", [], ["guild-a"], undefined)).toEqual({
      kind: "unavailable",
    });
  });

  test("no shared eligible guild fails closed", () => {
    expect(
      resolveConsumerAccess("beta", ["guild-a"], ["guild-b"], undefined),
    ).toEqual({ kind: "forbidden" });
    expect(eligibleConsumerGuildIds([], ["guild-a"])).toEqual([]);
  });
});
