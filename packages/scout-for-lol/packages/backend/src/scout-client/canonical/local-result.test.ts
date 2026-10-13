import { expect, test } from "vitest";
import { z } from "zod";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { parseLocalGameResult } from "./local-result.ts";

const HistorySchema = z
  .object({
    participantIdentities: z.array(
      z.looseObject({ player: z.looseObject({ puuid: z.string() }) }),
    ),
  })
  .loose();
const matchId = RiotMatchIdSchema.parse("NA1_5652513129");

test("a real full history produces a result without EOG, timing or resolved opponents", async () => {
  const game = HistorySchema.parse(
    await Bun.file(
      new URL(
        "../../../../../testdata/lcu/lcu-game-ranked-solo.json",
        import.meta.url,
      ),
    ).json(),
  );
  const observer = game.participantIdentities[0]?.player.puuid;
  if (observer === undefined) throw new Error("Fixture has no observer");
  const result = parseLocalGameResult(
    matchId,
    { resource: "match_history_game:5652513129", data: { matchHistory: game } },
    observer,
    "evidence",
  );
  expect(result).not.toBeNull();
  expect(result?.participants).toHaveLength(10);
  expect(
    result?.participants.some((player) => player.identity.kind === "local"),
  ).toBe(true);
  expect(
    parseLocalGameResult(
      RiotMatchIdSchema.parse("EUW1_5652513129"),
      { resource: "match_history_game:5652513129", data: game },
      observer,
      "evidence",
    ),
  ).toBeNull();
  expect(
    parseLocalGameResult(
      matchId,
      { resource: "match_history_game:5654104474", data: game },
      observer,
      "evidence",
    ),
  ).toBeNull();
  expect(
    parseLocalGameResult(
      matchId,
      { resource: "match_history_game:5654104474", data: game },
      "unrelated",
      "evidence",
    ),
  ).toBeNull();
});

test("a list row or incomplete roster is evidence, never a complete result", () => {
  expect(
    parseLocalGameResult(
      matchId,
      {
        resource: "match_history_game:5654104474",
        data: { gameId: 5_654_104_474, participants: [] },
      },
      "observer",
      "evidence",
    ),
  ).toBeNull();
});
