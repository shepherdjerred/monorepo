import { describe, it, expect } from "bun:test";
import type { RawParticipant } from "@scout-for-lol/data";
import {
  groupArenaTeams,
  getArenaTeammate,
  toArenaSubteams,
} from "@scout-for-lol/backend/league/model/match.ts";

import { testPuuid } from "@scout-for-lol/backend/testing/test-ids.ts";

function makeParticipant(extra: Record<string, unknown> = {}): RawParticipant {
  // eslint-disable-next-line custom-rules/no-type-assertions -- not worth fully defining the type
  return {
    puuid: crypto.randomUUID(),
    riotIdGameName: "P#NA1",
    summonerName: "P",
    championName: "Lux",
    kills: 1,
    deaths: 1,
    assists: 1,
    champLevel: 18,
    item0: 0,
    item1: 0,
    item2: 0,
    item3: 0,
    item4: 0,
    item5: 0,
    item6: 0,
    summoner1Id: 4,
    summoner2Id: 7,
    totalMinionsKilled: 0,
    neutralMinionsKilled: 0,
    visionScore: 0,
    totalDamageDealtToChampions: 0,
    goldEarned: 0,
    teamPosition: "UTILITY",
    teamId: 100,
    playerAugment1: 0,
    playerAugment2: 0,
    playerAugment3: 0,
    playerAugment4: 0,
    playerAugment5: 0,
    playerAugment6: 0,
    PlayerScore0: 0,
    PlayerScore1: 0,
    PlayerScore2: 0,
    PlayerScore3: 0,
    PlayerScore4: 0,
    PlayerScore5: 0,
    PlayerScore6: 0,
    PlayerScore7: 0,
    PlayerScore8: 0,
    ...extra,
  } satisfies Partial<RawParticipant> as unknown as RawParticipant;
}

describe("arena team grouping and teammate lookup", () => {
  it("groups participants into 8 subteams of 2", () => {
    const participants: RawParticipant[] = [];
    for (let sub = 1; sub <= 8; sub++) {
      participants.push(makeParticipant({ playerSubteamId: sub }));
      participants.push(makeParticipant({ playerSubteamId: sub }));
    }
    const groups = groupArenaTeams(participants);
    expect(groups.length).toBe(8);
    expect(groups.every((g) => g.players.length === 2)).toBe(true);
  });

  it("getArenaTeammate returns the other participant in the same subteam", () => {
    const a = makeParticipant({ puuid: testPuuid("A"), playerSubteamId: 3 });
    const b = makeParticipant({ puuid: testPuuid("B"), playerSubteamId: 3 });
    const c = makeParticipant({ puuid: testPuuid("C"), playerSubteamId: 4 });
    const teammate = getArenaTeammate(a, [a, b, c]);
    expect(teammate?.puuid).toBe(testPuuid("B"));
  });

  it("throws on invalid subteam ids or wrong sizes", () => {
    const bad = [makeParticipant({ playerSubteamId: 0 })];
    expect(() => groupArenaTeams(bad)).toThrow();
  });

  it("throws when placements within a subteam are inconsistent", () => {
    const a = makeParticipant({ playerSubteamId: 2, placement: 1 });
    const b = makeParticipant({ playerSubteamId: 2, placement: 2 });
    const others = [
      makeParticipant({ playerSubteamId: 1, placement: 3 }),
      makeParticipant({ playerSubteamId: 1, placement: 3 }),
      makeParticipant({ playerSubteamId: 3, placement: 4 }),
      makeParticipant({ playerSubteamId: 3, placement: 4 }),
      makeParticipant({ playerSubteamId: 4, placement: 5 }),
      makeParticipant({ playerSubteamId: 4, placement: 5 }),
      makeParticipant({ playerSubteamId: 5, placement: 6 }),
      makeParticipant({ playerSubteamId: 5, placement: 6 }),
      makeParticipant({ playerSubteamId: 6, placement: 7 }),
      makeParticipant({ playerSubteamId: 6, placement: 7 }),
      makeParticipant({ playerSubteamId: 7, placement: 8 }),
      makeParticipant({ playerSubteamId: 7, placement: 8 }),
      makeParticipant({ playerSubteamId: 8, placement: 1 }),
      makeParticipant({ playerSubteamId: 8, placement: 1 }),
    ];
    const participants = [a, b, ...others];
    expect(async () => {
      await toArenaSubteams(participants);
    }).toThrow();
  });
});
