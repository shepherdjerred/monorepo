import { describe, expect, test } from "vitest";
import { isBettableGame, isBettableQueue } from "#src/betting/eligibility.ts";
import { isAiReviewableQueue } from "#src/league/tasks/postmatch/match-report-ai-review.ts";

function lobby(blue: number, red: number) {
  return [
    ...Array.from({ length: blue }, () => ({ teamId: 100 })),
    ...Array.from({ length: red }, () => ({ teamId: 200 })),
  ];
}

describe("custom games and Bryan Bucks", () => {
  test("a plain custom is never bettable", () => {
    // "custom" is deliberately absent from BUCKS_EARNING_QUEUES: an arbitrary
    // custom is trivially farmable — ten accounts, instant surrender, repeat —
    // and earn_game moves real balance.
    expect(isBettableQueue("custom")).toBe(false);
    expect(
      isBettableGame({ queueType: "custom", participants: lobby(5, 5) }),
    ).toBe(false);
  });

  test("a Scout-minted 5v5 custom is bettable", () => {
    expect(
      isBettableGame({
        queueType: "custom",
        participants: lobby(5, 5),
        isScoutTournamentLobby: true,
      }),
    ).toBe(true);
  });

  test("a Scout-minted lobby below 5v5 is not", () => {
    // The MVP formula normalizes each player's share against a hardcoded
    // five-man baseline, so a smaller lobby produces systematically wrong
    // grades and payouts rather than merely noisy ones.
    for (const [blue, red] of [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]) {
      expect(
        isBettableGame({
          queueType: "custom",
          participants: lobby(blue ?? 0, red ?? 0),
          isScoutTournamentLobby: true,
        }),
      ).toBe(false);
    }
  });

  test("the Scout flag does not make a non-custom queue bettable on its own", () => {
    expect(
      isBettableGame({
        queueType: "aram",
        participants: lobby(5, 5),
        isScoutTournamentLobby: true,
      }),
    ).toBe(false);
  });

  test("ranked queues are unaffected", () => {
    for (const queue of ["solo", "flex", "clash"] as const) {
      expect(
        isBettableGame({ queueType: queue, participants: lobby(5, 5) }),
      ).toBe(true);
    }
  });
});

describe("custom games and AI review", () => {
  test("a custom is reviewable", () => {
    // Any custom reaching the post-match pipeline is necessarily a
    // tournament-code game — plain customs are absent from Match-V5 — so
    // reaching the gate is itself the proof Scout minted it.
    expect(isAiReviewableQueue("custom")).toBe(true);
  });

  test("ranked queues stay reviewable and casual ones stay out", () => {
    expect(isAiReviewableQueue("solo")).toBe(true);
    expect(isAiReviewableQueue("clash")).toBe(true);
    expect(isAiReviewableQueue("aram")).toBe(false);
    expect(isAiReviewableQueue("draft pick")).toBe(false);
    expect(isAiReviewableQueue(undefined)).toBe(false);
  });
});
