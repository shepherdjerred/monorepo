import { Constants } from "npm:twisted@1.57.0";
// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import { MatchV5DTOs } from "npm:twisted@1.57.0/dist/models-dto/index.js";
import { z } from "https://esm.sh/zod@3.22.4";
import { api } from "../../api/api.ts";
import {
  AttachmentBuilder,
  EmbedBuilder,
  Message,
  MessageCreateOptions,
  MessagePayload,
} from "npm:discord.js@14.14.1";
import { matchToImage } from "../../image/html/index.tsx";
import {
  ApplicationState,
  CompletedMatch,
  LoadingScreenState,
  Player,
  PlayerConfigEntry,
} from "@discord/data";
import { s3 } from "../../s3.ts";
import { PutObjectCommand } from "https://esm.sh/@aws-sdk/client-s3";
import configuration from "../../../configuration.ts";
import { getState, setState } from "../../model/state.ts";
import { toMatch } from "../../model/match.ts";
import { assert } from "https://deno.land/std@0.218.0/assert/mod.ts";

export async function checkMatch(game: LoadingScreenState) {
  try {
    // TODO: get region from player
    const response = await api.MatchV5.get(
      `NA1_${game.matchId}`,
      Constants.RegionGroups.AMERICAS
    );
    return response.response;
  } catch (e) {
    const result = z.object({ status: z.number() }).safeParse(e);
    if (result.success) {
      if (result.data.status == 404) {
        // game not done
        return undefined;
      }
    }
    console.error(e);
    return undefined;
  }
}

export async function saveMatch(match: MatchV5DTOs.MatchDto) {
  const command = new PutObjectCommand({
    Bucket: configuration.s3BucketName,
    Key: `matches/${match.info.gameId}.json`,
    Body: JSON.stringify(match),
    ContentType: "application/json",
  });
  await s3.send(command);
}

async function getImage(
  match: CompletedMatch
): Promise<[AttachmentBuilder, EmbedBuilder]> {
  const image = await matchToImage(match);
  const attachment = new AttachmentBuilder(image).setName("match.png");
  const embed = new EmbedBuilder().setImage(`attachment://${attachment.name}`);
  return [attachment, embed];
}

async function createMatchObj(
  state: LoadingScreenState,
  match: MatchV5DTOs.MatchDto,
  getPlayerFn: (playerConfig: PlayerConfigEntry) => Promise<Player>
) {
  const player = _.chain(match.info.participants)
    .filter(
      (participant) =>
        participant.puuid === state.players[0].player.league.leagueAccount.puuid
    )
    .first()
    .value();

  if (player == undefined) {
    throw new Error(
      `unable to find player ${JSON.stringify(state)}, ${JSON.stringify(match)}`
    );
  }

  const fullPlayer = await getPlayerFn(state.players[0].player);

  // it should be impossible for this to be undefined after a game
  assert(fullPlayer.ranks.solo != undefined);

  // TODO use correct rank
  return toMatch(
    fullPlayer,
    match,
    state.players[0].rank,
    fullPlayer.ranks.solo
  );
}

export async function checkPostMatchInternal(
  state: ApplicationState,
  saveFn: (match: MatchV5DTOs.MatchDto) => Promise<void>,
  checkFn: (
    game: LoadingScreenState
  ) => Promise<MatchV5DTOs.MatchDto | undefined>,
  sendFn: (
    message: string | MessagePayload | MessageCreateOptions
  ) => Promise<Message<true> | Message<false>>,
  getPlayerFn: (playerConfig: PlayerConfigEntry) => Promise<Player>
) {
  console.log("checking match api");
  const games = await Promise.all(_.map(state.gamesStarted, checkFn));

  console.log("removing games in progress");
  const finishedGames = _.chain(state.gamesStarted)
    .zip(games)
    .filter(([_game, match]) => match != undefined)
    .value() as [LoadingScreenState, MatchV5DTOs.MatchDto][];

  // TODO: send duo queue message
  console.log("sending messages");
  await Promise.all(
    _.map(finishedGames, async ([state, matchDto]) => {
      await saveFn(matchDto);

      const matchObj = await createMatchObj(state, matchDto, getPlayerFn);

      const [attachment, embed] = await getImage(matchObj);
      await sendFn({ embeds: [embed], files: [attachment] });

      console.log("calculating new state");
      const newState = getState();
      const newMatches = _.differenceBy(
        newState.gamesStarted,
        _.map(finishedGames, (game) => game[0]),
        (state) => state.uuid
      );

      console.log("saving state files");
      setState({
        ...state,
        gamesStarted: newMatches,
      });
    })
  );
}
