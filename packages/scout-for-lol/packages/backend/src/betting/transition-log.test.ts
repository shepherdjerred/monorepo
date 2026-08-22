import { describe, expect, test } from "bun:test";
import { logBucksTransition } from "#src/betting/transition-log.ts";

describe("logBucksTransition", () => {
  test("accepts a minimal transition", () => {
    expect(() => {
      logBucksTransition({ event: "bucks.pool.opened" });
    }).not.toThrow();
  });

  test("accepts a fully populated transition", () => {
    expect(() => {
      logBucksTransition({
        event: "bucks.bet.placed",
        matchId: "NA1_1",
        serverId: "1337623164146155593",
        poolId: 1,
        betId: 2,
        bucksAccountId: 3,
        actorDiscordId: "test-discord-account",
        fromState: "open",
        toState: "open",
        teamId: 100,
        stake: 5,
        balanceAfter: 20,
        surface: "button",
        queueType: "solo",
      });
    }).not.toThrow();
  });

  // Observability must never fail product behaviour. This helper sits inside
  // settlement paths, so a throw here would abort a money movement. Every
  // event in the union must be safe to log.
  test("never throws for any event in the union", () => {
    const events = [
      "bucks.pool.opened",
      "bucks.pool.closed",
      "bucks.pool.settled",
      "bucks.pool.voided",
      "bucks.bet.placed",
      "bucks.bet.rejected",
      "bucks.bet.cancelled",
      "bucks.parlay.settled",
      "bucks.earning.awarded",
      "bucks.peek_pass.purchased",
    ] as const;
    for (const event of events) {
      expect(() => {
        logBucksTransition({ event });
      }).not.toThrow();
    }
  });
});
