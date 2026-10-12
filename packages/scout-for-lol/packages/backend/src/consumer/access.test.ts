import { DiscordGuildIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
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
        ["814966221255294277", "819955801223314665"],
        [
          DiscordGuildIdSchema.parse("819955801223314665"),
          DiscordGuildIdSchema.parse("817735877485972793"),
        ],
        undefined,
      ),
    ).toEqual({
      kind: "allowed",
      guildIds: [DiscordGuildIdSchema.parse("819955801223314665")],
    });
  });

  test("production intersects membership with the installed guilds", () => {
    expect(
      resolveConsumerAccess(
        "prod",
        ["ignored-in-production"],
        [
          DiscordGuildIdSchema.parse("814966221255294277"),
          DiscordGuildIdSchema.parse("819955801223314665"),
        ],
        ["819955801223314665", "817735877485972793"],
      ),
    ).toEqual({
      kind: "allowed",
      guildIds: [DiscordGuildIdSchema.parse("819955801223314665")],
    });
  });

  test("an unavailable production answer is not reported as forbidden", () => {
    expect(
      resolveConsumerAccess(
        "prod",
        [],
        [DiscordGuildIdSchema.parse("814966221255294277")],
        undefined,
      ),
    ).toEqual({
      kind: "unavailable",
    });
  });

  test("no shared eligible guild fails closed", () => {
    expect(
      resolveConsumerAccess(
        "beta",
        ["814966221255294277"],
        [DiscordGuildIdSchema.parse("819955801223314665")],
        undefined,
      ),
    ).toEqual({ kind: "forbidden" });
    expect(
      eligibleConsumerGuildIds(
        [],
        [DiscordGuildIdSchema.parse("814966221255294277")],
      ),
    ).toEqual([]);
  });
});

describe("installed guild lookup", () => {
  test("passes an answer through", async () => {
    const installed = await installedGuildIdsOrUnavailable(
      [
        DiscordGuildIdSchema.parse("814966221255294277"),
        DiscordGuildIdSchema.parse("819955801223314665"),
      ],
      (guildIds) => Promise.resolve(guildIds.slice(0, 1)),
    );
    expect([...(installed ?? [])]).toEqual(["814966221255294277"]);
  });

  test("reports an unreachable install source as no answer", async () => {
    // The whole reason this is not a `catch`-and-return-empty: an empty set is
    // an authoritative "Scout is in none of your servers", which would lock a
    // real member out of production while the database was briefly unreachable.
    const installed = await installedGuildIdsOrUnavailable(
      [DiscordGuildIdSchema.parse("814966221255294277")],
      () => Promise.reject(new Error("database unreachable")),
    );
    expect(installed).toBeUndefined();
  });
});
