import { DiscordGuildIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { describe, expect, test } from "vitest";
import {
  aggregateBucksPendingStakes,
  countBucksOpenMarkets,
} from "#src/analytics/bryan-bucks-events.ts";

describe("aggregateBucksPendingStakes", () => {
  test("sums outcome, parlay, and dare pending stakes per server", () => {
    const result = aggregateBucksPendingStakes(
      [
        {
          stake: 10,
          matchedStake: 6,
          bucksAccount: {
            serverId: DiscordGuildIdSchema.parse("815759770816628172"),
          },
        },
      ],
      [
        {
          stake: 3,
          bucksAccount: {
            serverId: DiscordGuildIdSchema.parse("815759770816628172"),
          },
        },
      ],
      [
        {
          stake: 2,
          bucksAccount: {
            serverId: DiscordGuildIdSchema.parse("817012073593481124"),
          },
        },
      ],
    );
    expect(result.get("815759770816628172")).toBe(9);
    expect(result.get("817012073593481124")).toBe(2);
  });

  test("an unmatched outcome bet counts its full stake, not the matched portion", () => {
    const result = aggregateBucksPendingStakes(
      [
        {
          stake: 10,
          matchedStake: null,
          bucksAccount: {
            serverId: DiscordGuildIdSchema.parse("815759770816628172"),
          },
        },
      ],
      [],
      [],
    );
    expect(result.get("815759770816628172")).toBe(10);
  });

  test("dare escrow counts as pending stake alongside outcome and parlay money", () => {
    const result = aggregateBucksPendingStakes(
      [
        {
          stake: 5,
          matchedStake: 5,
          bucksAccount: {
            serverId: DiscordGuildIdSchema.parse("815759770816628172"),
          },
        },
      ],
      [
        {
          stake: 3,
          bucksAccount: {
            serverId: DiscordGuildIdSchema.parse("815759770816628172"),
          },
        },
      ],
      [
        {
          stake: 7,
          bucksAccount: {
            serverId: DiscordGuildIdSchema.parse("815759770816628172"),
          },
        },
      ],
    );
    expect(result.get("815759770816628172")).toBe(15);
  });

  test("dare escrow alone still attributes to the right server", () => {
    const result = aggregateBucksPendingStakes(
      [],
      [],
      [
        {
          stake: 4,
          bucksAccount: {
            serverId: DiscordGuildIdSchema.parse("812514823867730875"),
          },
        },
      ],
    );
    expect(result.get("812514823867730875")).toBe(4);
    expect(result.get("815759770816628172")).toBeUndefined();
  });

  test("omitting dare stakes entirely defaults to zero contribution", () => {
    const result = aggregateBucksPendingStakes(
      [
        {
          stake: 1,
          matchedStake: 1,
          bucksAccount: {
            serverId: DiscordGuildIdSchema.parse("815759770816628172"),
          },
        },
      ],
      [],
      [],
    );
    expect(result.get("815759770816628172")).toBe(1);
  });
});

describe("countBucksOpenMarkets", () => {
  test("counts open pools per server", () => {
    const result = countBucksOpenMarkets([
      { serverId: DiscordGuildIdSchema.parse("815759770816628172") },
      { serverId: DiscordGuildIdSchema.parse("815759770816628172") },
      { serverId: DiscordGuildIdSchema.parse("817012073593481124") },
    ]);
    expect(result.get("815759770816628172")).toBe(2);
    expect(result.get("817012073593481124")).toBe(1);
  });
});
