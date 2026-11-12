import {
  ParticipantIdentitySchema,
  type ParticipantIdentity,
} from "@scout-for-lol/domain/artifacts/game-result.ts";
import { LCU_BOT_UUID, isLcuUuid } from "#src/scout-client/identity-alias.ts";

/**
 * Who a League-client roster entry names, once aliases are translated.
 *
 * `puuid` is what the League client put in the entry: a Riot PUUID after
 * translation, a League-client UUID still awaiting its alias, or the shared
 * bot UUID. `bot` is the entry's own bot flag where the source states one.
 * Anything that fits none of those, or a flag that contradicts the UUID, is
 * `null`: the converter refuses the game rather than guessing who it was.
 */
export function lcuParticipantIdentity(
  puuid: string,
  bot: boolean | undefined,
): ParticipantIdentity | null {
  const botUuid = puuid === LCU_BOT_UUID || puuid === "";
  if (bot === true || (bot === undefined && puuid === LCU_BOT_UUID)) {
    return botUuid ? { kind: "bot" } : null;
  }
  if (botUuid) return null;
  const riot = ParticipantIdentitySchema.safeParse({ kind: "riot", puuid });
  if (riot.success) return riot.data;
  return isLcuUuid(puuid) ? { kind: "local", uuid: puuid } : null;
}
