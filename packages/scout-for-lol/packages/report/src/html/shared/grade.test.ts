import { test, expect } from "bun:test";
import { rankedFixture } from "#src/html/shared/test-fixtures.ts";
import { findMvpIndex } from "#src/html/shared/grade.ts";

function puuidAt(
  players: ReturnType<typeof rankedFixture>["players"],
  index: number | undefined,
): string {
  if (index === undefined) throw new Error("expected an MVP index");
  const player = players[index];
  if (!player) throw new Error(`no player at index ${index.toString()}`);
  return String(player.playerConfig.league.leagueAccount.puuid);
}

test("findMvpIndex breaks KDA ties by puuid, independent of player order", () => {
  const match = rankedFixture({
    queueType: "solo",
    trackedCount: 3,
    outcome: "Victory",
  });
  // Force every tracked player to the same KDA so only the tie-break decides.
  const tied = match.players.map((player) => ({
    ...player,
    champion: { ...player.champion, kills: 10, deaths: 5, assists: 5 },
  }));

  const forwardPuuid = puuidAt(tied, findMvpIndex(tied));
  const reversed = [...tied].reverse();
  const reversedPuuid = puuidAt(reversed, findMvpIndex(reversed));

  // The deterministic winner is the lexicographically smallest puuid — the same
  // player no matter what order getAccountsWithState() returned them in.
  const [smallestPuuid] = [...tied]
    .map((player) => String(player.playerConfig.league.leagueAccount.puuid))
    .sort();
  if (smallestPuuid === undefined) throw new Error("expected a puuid");

  expect(forwardPuuid).toBe(reversedPuuid);
  expect(forwardPuuid).toBe(smallestPuuid);
});
