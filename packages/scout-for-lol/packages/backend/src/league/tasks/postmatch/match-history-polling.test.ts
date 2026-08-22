import { describe, expect, test } from "vitest";
import { shouldAnnounceBucks } from "#src/league/tasks/postmatch/match-history-polling.ts";

describe("shouldAnnounceBucks", () => {
  test("announces a silent match with only a parlay bettor settlement", () => {
    expect(
      shouldAnnounceBucks({
        silent: true,
        bucks: {
          closures: [],
          settlements: [],
          parlaySettlements: [
            {
              matchId: "NA1_42",
              serverId: "1337623164146155593",
              yesResult: true,
              voidReason: undefined,
              legs: [],
              messageRefs: [],
              bets: [
                {
                  discordId: "bettor-discord-id",
                  side: "YES",
                  stake: 5,
                  grossPayout: 10,
                  payout: 10,
                  outcome: "won",
                },
              ],
            },
          ],
          earnings: [],
        },
      }),
    ).toBe(true);
  });

  test("keeps a silent match with no bettor activity quiet", () => {
    expect(
      shouldAnnounceBucks({
        silent: true,
        bucks: {
          closures: [],
          settlements: [],
          parlaySettlements: [],
          earnings: [],
        },
      }),
    ).toBe(false);
  });
});
