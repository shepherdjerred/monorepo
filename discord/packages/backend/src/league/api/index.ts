import {
  CurrentGameInfoDTO,
  CurrentGameParticipantDTO,
  SpectatorNotAvailableDTO,
} from "npm:twisted@1.57.0/dist/models-dto/index.js";
import { z } from "https://esm.sh/zod@3.22.4";
import { PlayerConfigEntry } from "@discord/data";
import { api } from "./api.ts";
import { Constants } from "npm:twisted@1.57.0";
// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";

export async function getCurrentGame(
  player: PlayerConfigEntry
): Promise<undefined | CurrentGameInfoDTO> {
  try {
    const response = await api.Spectator.activeGame(
      player.league.leagueAccount.id,
      Constants.Regions[player.league.leagueAccount.region]
    );
    if (response instanceof SpectatorNotAvailableDTO) {
      return undefined;
    } else {
      return response.response;
    }
  } catch (e) {
    const result = z.object({ status: z.number() }).safeParse(e);
    if (result.success) {
      if (result.data.status == 404) {
        // not in game
        return undefined;
      }
    }
    throw e;
  }
}

export function findParticipant(
  player: PlayerConfigEntry,
  participants: CurrentGameParticipantDTO[]
): CurrentGameParticipantDTO | undefined {
  return _.chain(participants)
    .filter(
      (participant) => participant.summonerId === player.league.leagueAccount.id
    )
    .first()
    .value();
}
