import {
  type ArenaChampion,
  type Augment,
  type RawParticipant,
} from "@scout-for-lol/data";
import { participantToChampion } from "@scout-for-lol/data/model/match-helpers";
import { mapAugmentIdsToUnion } from "@scout-for-lol/backend/league/arena/augment";

// Arena champion conversion with arena-specific fields
export function participantToArenaChampion(dto: RawParticipant): ArenaChampion {
  const baseChampion = participantToChampion(dto);

  const augments = extractAugments(dto);
  const arenaMetrics = extractArenaMetrics(dto);
  const teamSupport = extractTeamSupport(dto);

  return {
    ...baseChampion,
    augments,
    arenaMetrics,
    teamSupport,
  };
}

// Helpers for arena-specific fields
function extractAugments(dto: RawParticipant): Augment[] {
  const ids: number[] = [];
  const augmentFields = [
    dto.playerAugment1,
    dto.playerAugment2,
    dto.playerAugment3,
    dto.playerAugment4,
    dto.playerAugment5,
    dto.playerAugment6,
  ];
  for (const augment of augmentFields) {
    if (augment !== undefined && augment !== 0) {
      ids.push(augment);
    }
  }
  if (ids.length === 0) {
    return [];
  }
  return mapAugmentIdsToUnion(ids);
}

function extractArenaMetrics(dto: RawParticipant) {
  return {
    playerScore0: dto.playerScore0 ?? dto.PlayerScore0 ?? 0,
    playerScore1: dto.playerScore1 ?? dto.PlayerScore1 ?? 0,
    playerScore2: dto.playerScore2 ?? dto.PlayerScore2 ?? 0,
    playerScore3: dto.playerScore3 ?? dto.PlayerScore3 ?? 0,
    playerScore4: dto.playerScore4 ?? dto.PlayerScore4 ?? 0,
    playerScore5: dto.playerScore5 ?? dto.PlayerScore5 ?? 0,
    playerScore6: dto.playerScore6 ?? dto.PlayerScore6 ?? 0,
    playerScore7: dto.playerScore7 ?? dto.PlayerScore7 ?? 0,
    playerScore8: dto.playerScore8 ?? dto.PlayerScore8 ?? 0,
  };
}

function extractTeamSupport(dto: RawParticipant) {
  return {
    damageShieldedOnTeammate: dto.totalDamageShieldedOnTeammates,
    healsOnTeammate: dto.totalHealsOnTeammates,
    damageTakenPercentage: dto.challenges?.damageTakenOnTeamPercentage ?? 0,
  };
}
