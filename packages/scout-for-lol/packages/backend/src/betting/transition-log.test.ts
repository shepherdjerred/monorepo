import { describe, expect, test } from "vitest";
import {
  logBucksTransition,
  type BucksTransitionEvent,
} from "#src/betting/transition-log.ts";

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

describe("BucksTransitionEvent coverage", () => {
  // Codex's review of #2327 found that every declared parlay event existed
  // only in the type union — nothing in src/betting/ ever called
  // logBucksTransition with it. This scans the actual source for every event
  // literal so a future declared-but-unwired event fails here instead of
  // silently producing an empty log stream.
  test("every declared event has at least one call site", async () => {
    const declared: BucksTransitionEvent[] = [
      "bucks.pool.opened",
      "bucks.pool.closed",
      "bucks.pool.settled",
      "bucks.pool.voided",
      "bucks.bet.placed",
      "bucks.bet.topped_up",
      "bucks.bet.rejected",
      "bucks.bet.cancelled",
      "bucks.bet.matched",
      "bucks.bet.unmatched_refunded",
      "bucks.bet.house_filled",
      "bucks.bet.won",
      "bucks.bet.lost",
      "bucks.bet.refunded",
      "bucks.parlay.published",
      "bucks.parlay.opened",
      "bucks.parlay.closed",
      "bucks.parlay.settled",
      "bucks.parlay.voided",
      "bucks.parlay_bet.placed",
      "bucks.parlay_bet.cancelled",
      "bucks.parlay_bet.settled",
      "bucks.earning.awarded",
      "bucks.peek_pass.purchased",
    ];

    const glob = new Bun.Glob("*.ts");
    const bettingDir = new URL("./", import.meta.url).pathname;
    const missing: string[] = [];
    for (const event of declared) {
      let found = false;
      for await (const file of glob.scan(bettingDir)) {
        if (file === "transition-log.ts" || file.endsWith(".test.ts")) {
          continue;
        }
        const text = await Bun.file(`${bettingDir}${file}`).text();
        if (text.includes(`"${event}"`)) {
          found = true;
          break;
        }
      }
      if (!found) missing.push(event);
    }

    expect(missing).toEqual([]);
  });
});
