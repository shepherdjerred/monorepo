import { matchToSvg } from "./index.tsx";
import { MatchV5DTOs } from "npm:twisted@1.57.0/dist/models-dto/index.js";
import { assertSnapshot } from "https://deno.land/std@0.218.2/testing/snapshot.ts";
import { toMatch } from "../../model/match.ts";

const testdataPath = new URL("testdata/match.json", import.meta.url);

Deno.test("image matches", async (t) => {
  const exampleMatch = JSON.parse(
    (await Deno.readTextFile(testdataPath)).toString(),
  ) as MatchV5DTOs.MatchDto;

  const matchObj = toMatch(
    {
      config: {
        name: "name",
        league: {
          leagueAccount: {
            puuid:
              "XtEsV464OFaO3c0_q9REa6wYF0HpC2LK4laLnyM7WhfAVeuDz9biieJ5ZRD049AUCBjLjyBeeezTaw",
            accountId: "accountId",
            id: "id",
            region: "AMERICA_NORTH",
          },
        },
        discordAccount: {
          id: "discord id",
        },
      },
      ranks: {
        solo: { division: 3, tier: "gold", lp: 11, wins: 10, losses: 20 },
        flex: { division: 1, tier: "gold", lp: 4, wins: 50, losses: 30 },
      },
    },
    exampleMatch,
    { division: 4, tier: "gold", lp: 11, wins: 10, losses: 20 },
    { division: 1, tier: "gold", lp: 4, wins: 50, losses: 30 },
  );
  const svg = await matchToSvg(matchObj);
  await assertSnapshot(t, svg);
});
