import { describe, expect, test } from "vitest";
import {
  eligibleConsumerGuildIds,
  installedGuildIdsOrUnavailable,
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

  test("production intersects membership with the installed guilds", () => {
    expect(
      resolveConsumerAccess(
        "prod",
        ["ignored-in-production"],
        ["guild-a", "guild-b"],
        ["guild-b", "guild-c"],
      ),
    ).toEqual({ kind: "allowed", guildIds: ["guild-b"] });
  });

  test("an unavailable production answer is not reported as forbidden", () => {
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

describe("installed guild lookup", () => {
  test("passes an answer through", async () => {
    const installed = await installedGuildIdsOrUnavailable(
      ["guild-a", "guild-b"],
      (guildIds) => Promise.resolve(guildIds.slice(0, 1)),
    );
    expect([...(installed ?? [])]).toEqual(["guild-a"]);
  });

  test("reports an unreachable install source as no answer", async () => {
    // The whole reason this is not a `catch`-and-return-empty: an empty set is
    // an authoritative "Scout is in none of your servers", which would lock a
    // real member out of production while the database was briefly unreachable.
    const installed = await installedGuildIdsOrUnavailable(["guild-a"], () =>
      Promise.reject(new Error("database unreachable")),
    );
    expect(installed).toBeUndefined();
  });
});
