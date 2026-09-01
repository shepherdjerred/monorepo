import { describe, expect, test } from "vitest";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import {
  activeDareTargetPuuids,
  selectMatchPollAccounts,
  unavailableRequiredPuuids,
  type MatchPollAccount,
} from "#src/league/tasks/postmatch/match-discovery-selection.ts";

const NOW = new Date("2026-09-01T12:00:00.000Z");

function puuid(label: string) {
  return LeaguePuuidSchema.parse(label.padEnd(78, "x"));
}

function account(
  rawPuuid: string,
  lastCheckedAt: Date | undefined,
): MatchPollAccount {
  return {
    config: {
      alias: rawPuuid,
      league: {
        leagueAccount: {
          puuid: LeaguePuuidSchema.parse(rawPuuid),
          region: "AMERICA_NORTH",
        },
      },
      discordAccount: {},
    },
    lastMatchTime: new Date("2026-08-01T12:00:00.000Z"),
    lastCheckedAt,
  };
}

describe("post-match discovery selection", () => {
  test("polls every active Dare account outside ordinary eligibility and caps", () => {
    const recentlyChecked = new Date(NOW.getTime() - 60_000);
    const dareA = puuid("dare-a");
    const dareB = puuid("dare-b");
    const selected = selectMatchPollAccounts({
      accounts: [
        account(puuid("ordinary-old"), undefined),
        account(dareB, recentlyChecked),
        account(dareA, recentlyChecked),
      ],
      requiredPuuids: new Set([dareA, dareB]),
      currentTime: NOW,
      ordinaryLimit: 1,
    });

    expect(
      selected.map((candidate) => candidate.config.league.leagueAccount.puuid),
    ).toEqual([dareA, dareB]);
  });

  test("identifies a frozen Dare account that is no longer configured", () => {
    const missing = puuid("missing");
    expect(
      unavailableRequiredPuuids({
        accounts: [account(puuid("available"), undefined)],
        requiredPuuids: new Set([missing]),
      }),
    ).toEqual([missing]);
  });

  test("parses every frozen account for active-target prioritization", () => {
    expect(
      activeDareTargetPuuids([
        {
          accounts: JSON.stringify([
            {
              puuid: "one",
              trackingStartedAt: "2026-08-01T00:00:00.000Z",
            },
            {
              puuid: "two",
              trackingStartedAt: "2026-08-02T00:00:00.000Z",
            },
          ]),
        },
      ]),
    ).toEqual(new Set(["one", "two"]));
  });
});
