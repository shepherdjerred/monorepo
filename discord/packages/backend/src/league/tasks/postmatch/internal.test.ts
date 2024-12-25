import { MatchV5DTOs } from "npm:twisted@1.57.0/dist/models-dto/index.js";
import {
  ApplicationState,
  Player,
  PlayerConfigEntry,
} from "../../../../../data/src/model/index.ts";
import { send } from "../../discord/channel.ts";
import { checkPostMatchInternal } from "./internal.ts";
import { assertSnapshot } from "https://deno.land/std@0.218.2/testing/snapshot.ts";
import { MessageCreateOptions, MessagePayload } from "npm:discord.js@14.14.1";
import { Message } from "npm:discord.js@14.14.1";

const testdataPath = new URL("testdata/match.json", import.meta.url);

Deno.test("postmatch", async (t) => {
  const state: ApplicationState = {
    gamesStarted: [
      {
        uuid: "uuid",
        added: new Date(),
        matchId: 1,
        players: [{
          player: {
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
          rank: { division: 3, tier: "gold", lp: 11, wins: 10, losses: 20 },
        }],
      },
    ],
  };
  const saveMatchFn = async (_: MatchV5DTOs.MatchDto) => {
    // do nothing
  };
  const sendFn = (async (
    message: string | MessagePayload | MessageCreateOptions,
  ): Promise<Message<true> | Message<false>> => {
    await assertSnapshot(t, message);
    return Promise.resolve({} as Message<true> | Message<false>);
  }) as (typeof send);
  const checkMatchFn = async () => {
    const exampleMatch = JSON.parse(
      (await Deno.readTextFile(testdataPath)).toString(),
    ) as MatchV5DTOs.MatchDto;
    return exampleMatch;
  };
  const getPlayerFn = (
    _: PlayerConfigEntry,
  ): Promise<Player> => {
    return Promise.resolve({
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
      },
    });
  };
  await checkPostMatchInternal(
    state,
    saveMatchFn,
    checkMatchFn,
    sendFn,
    getPlayerFn,
  );
});
