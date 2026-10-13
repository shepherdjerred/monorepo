import type {
  CustomGameParticipant,
  CustomIntermissionChoice,
} from "@scout-for-lol/data";
import {
  rerollCaptainsWithinTeams,
  selectCaptainsExcludingPrevious,
} from "#src/customs/game/draft.ts";
import type { SecureRandom } from "#src/customs/random.ts";

export function nextCustomGameParticipants(
  participants: readonly CustomGameParticipant[],
  choice: CustomIntermissionChoice,
  random?: SecureRandom,
): CustomGameParticipant[] {
  if (choice === "KEEP_TEAMS_AND_CAPTAINS")
    return participants.map((participant) => ({
      ...participant,
      pickOrder: null,
      championId: null,
      won: null,
    }));
  if (choice === "KEEP_TEAMS_REROLL_CAPTAINS")
    return rerollCaptainsWithinTeams(participants, random).map(
      (participant) => ({
        ...participant,
        pickOrder: null,
        championId: null,
        won: null,
      }),
    );
  if (choice === "REDRAFT_SAME_CAPTAINS")
    return participants.map((participant) =>
      participant.captain
        ? { ...participant, pickOrder: null, championId: null, won: null }
        : {
            ...participant,
            team: null,
            side: null,
            pickOrder: null,
            championId: null,
            won: null,
          },
    );
  return selectCaptainsExcludingPrevious(participants, random).map(
    (participant) => ({ ...participant, championId: null, won: null }),
  );
}
