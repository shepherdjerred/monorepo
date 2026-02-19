import { describe, it, expect } from "bun:test";
import { participantToArenaChampion } from "@scout-for-lol/backend/league/model/champion.ts";
import {
  makeTestParticipant,
  makeTestChallenges,
} from "@scout-for-lol/backend/testing/riot-mocks.ts";

const baseParticipant = () =>
  makeTestParticipant({
    riotIdGameName: "Player#NA1",
    summonerName: "Player",
    championName: "Lux",
    kills: 3,
    deaths: 1,
    assists: 4,
    champLevel: 18,
    item0: 6655,
    item6: 3363,
    visionScore: 10,
    totalDamageDealtToChampions: 12_000,
    goldEarned: 9000,
    teamPosition: "UTILITY",
    playerAugment1: 667,
    playerAugment2: 0,
    playerAugment3: 123,
    playerAugment4: 0,
    playerAugment5: 0,
    playerAugment6: 0,
    totalDamageShieldedOnTeammates: 500,
    totalHealsOnTeammates: 300,
    PlayerScore0: 1,
    PlayerScore1: 2,
    PlayerScore2: 3,
    PlayerScore3: 4,
    PlayerScore4: 5,
    PlayerScore5: 6,
    PlayerScore6: 7,
    PlayerScore7: 8,
    PlayerScore8: 9,
    challenges: makeTestChallenges({ damageTakenOnTeamPercentage: 0.2 }),
    teamId: 100,
  });

describe("participantToArenaChampion", () => {
  it("extracts and filters augments, keeps order", async () => {
    const dto = baseParticipant();
    const champ = await participantToArenaChampion(dto);
    expect(champ.augments.map((a) => ("id" in a ? a.id : undefined))).toEqual([
      667, 123,
    ]);
  });

  it("copies base champion fields", async () => {
    const dto = baseParticipant();
    const champ = await participantToArenaChampion(dto);
    expect(champ.championName).toBe("Lux");
    expect(champ.level).toBe(18);
    expect(champ.gold).toBe(9000);
    expect(champ.damage).toBe(12_000);
  });

  it("maps team support and arena metrics", async () => {
    const dto = baseParticipant();
    const champ = await participantToArenaChampion(dto);
    expect(champ.teamSupport.damageShieldedOnTeammate).toBe(500);
    expect(champ.teamSupport.healsOnTeammate).toBe(300);
    expect(champ.arenaMetrics.playerScore0).toBe(1);
    expect(champ.arenaMetrics.playerScore8).toBe(9);
  });
});
