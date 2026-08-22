import { describe, expect, test } from "vitest";
import {
  isBettableGame,
  isBettableQueue,
  isStandardLobby,
} from "#src/betting/eligibility.ts";

function lobby(teamIds: readonly number[]) {
  return teamIds.map((teamId) => ({ teamId }));
}

const STANDARD = lobby([100, 100, 100, 100, 100, 200, 200, 200, 200, 200]);

describe("isBettableQueue", () => {
  test("accepts every supported ranked queue", () => {
    expect(isBettableQueue("solo")).toBe(true);
    expect(isBettableQueue("flex")).toBe(true);
    expect(isBettableQueue("classic")).toBe(false);
    expect(isBettableQueue("ranked 5s")).toBe(true);
    expect(isBettableQueue("clash")).toBe(true);
  });

  test("rejects ARAM Clash", () => {
    // The broader ranked helper permits this mode, but only standard Clash is
    // part of the economy.
    expect(isBettableQueue("aram clash")).toBe(false);
  });

  test("rejects League Classic, Classic Mayhem, and unknown queues", () => {
    expect(isBettableQueue("aram")).toBe(false);
    expect(isBettableQueue("classic")).toBe(false);
    expect(isBettableQueue("classic aram mayhem")).toBe(false);
    expect(isBettableQueue("arena")).toBe(false);
    expect(isBettableQueue("quickplay")).toBe(false);
    expect(isBettableQueue(undefined)).toBe(false);
  });
});

describe("isStandardLobby", () => {
  test("accepts a five-and-five lobby", () => {
    expect(isStandardLobby(STANDARD)).toBe(true);
  });

  test("rejects a lobby that is not ten participants", () => {
    expect(isStandardLobby(lobby([100, 100, 200, 200]))).toBe(false);
    expect(isStandardLobby([...STANDARD, { teamId: 100 }])).toBe(false);
  });

  test("rejects ten participants split unevenly", () => {
    expect(
      isStandardLobby(
        lobby([100, 100, 100, 100, 100, 100, 200, 200, 200, 200]),
      ),
    ).toBe(false);
  });

  test("rejects an Arena-shaped lobby carrying a foreign team id", () => {
    expect(
      isStandardLobby(lobby([100, 100, 100, 100, 100, 200, 200, 200, 200, 0])),
    ).toBe(false);
  });

  test("rejects a partially populated spectator lobby", () => {
    // The pre-start case active-game-detection already defers on.
    expect(isStandardLobby(lobby([100, 100, 200, 200, 100, 200]))).toBe(false);
  });
});

describe("isBettableGame", () => {
  test("requires both the queue and the lobby shape", () => {
    expect(isBettableGame({ queueType: "solo", participants: STANDARD })).toBe(
      true,
    );
    expect(
      isBettableGame({ queueType: "classic", participants: STANDARD }),
    ).toBe(false);
    expect(isBettableGame({ queueType: "aram", participants: STANDARD })).toBe(
      false,
    );
    expect(
      isBettableGame({
        queueType: "classic aram mayhem",
        participants: STANDARD,
      }),
    ).toBe(false);
    expect(
      isBettableGame({ queueType: "solo", participants: lobby([100, 200]) }),
    ).toBe(false);
  });
});
