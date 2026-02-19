import { describe, it, expect } from "bun:test";
import type { RawParticipant } from "@scout-for-lol/data";
import {
  groupArenaTeams,
  getArenaTeammate,
  toArenaSubteams,
} from "@scout-for-lol/backend/league/model/match.ts";

import { testPuuid } from "@scout-for-lol/backend/testing/test-ids.ts";
import { makeTestParticipant } from "@scout-for-lol/backend/testing/riot-mocks.ts";

function makeParticipant(extra: Partial<RawParticipant> = {}): RawParticipant {
  return makeTestParticipant(extra);
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
