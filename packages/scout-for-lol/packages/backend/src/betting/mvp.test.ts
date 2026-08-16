import { describe, expect, test } from "bun:test";
import {
  RawMatchSchema,
  RawParticipantSchema,
  type RawParticipant,
} from "@scout-for-lol/data/index.ts";
import { makeTestParticipant } from "#src/testing/riot-mocks.ts";
import { computeMvp, weightsForRole, type MvpRole } from "#src/betting/mvp.ts";

const riftFixture = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;

function puuidFor(index: number): string {
  return `p${index.toString().padStart(2, "0")}`.padEnd(78, "x");
}

/** Indexed access is `| undefined` under noUncheckedIndexedAccess, and the
 * modulo makes it unreachable — so narrow it rather than assert it away. */
function roleAt(index: number): (typeof ROLES)[number] {
  const role = ROLES[index % ROLES.length];
  if (role === undefined) {
    throw new Error("unreachable: modulo index is always in range");
  }
  return role;
}

/**
 * Build a full 5v5 through the strict participant schema, so a fixture that
 * drifts from Riot's real shape fails loudly instead of quietly testing a
 * payload production would reject.
 */
function buildLobby(
  overridesByIndex: Record<number, Partial<RawParticipant>> = {},
): RawParticipant[] {
  return Array.from({ length: 10 }, (_unused, index) => {
    const teamId = index < 5 ? 100 : 200;
    return RawParticipantSchema.parse(
      makeTestParticipant({
        puuid: puuidFor(index),
        teamId,
        win: teamId === 100,
        teamPosition: roleAt(index),
        individualPosition: roleAt(index),
        kills: 3,
        deaths: 3,
        assists: 5,
        totalDamageDealtToChampions: 15_000,
        damageDealtToObjectives: 5000,
        damageDealtToTurrets: 2000,
        visionScore: 20,
        totalHealsOnTeammates: 1000,
        totalDamageShieldedOnTeammates: 500,
        timeCCingOthers: 20,
        damageSelfMitigated: 10_000,
        dragonKills: 0,
        baronKills: 0,
        turretKills: 1,
        challenges: undefined,
        ...overridesByIndex[index],
      }),
    );
  });
}

describe("role weights", () => {
  test("every role's weights sum to 1.0", () => {
    const roles: MvpRole[] = [...ROLES, "DEFAULT"];
    for (const role of roles) {
      const weights = weightsForRole(role);
      const total =
        weights.combat +
        weights.damage +
        weights.objective +
        weights.vision +
        weights.utility +
        weights.survival;
      expect(Math.abs(total - 1)).toBeLessThan(1e-9);
    }
  });

  test("DEFAULT is the column-wise mean of the five real roles", () => {
    const fallback = weightsForRole("DEFAULT");
    const rows = ROLES.map((role) => weightsForRole(role));
    const meanOf = (pick: (w: (typeof rows)[number]) => number) =>
      rows.reduce((sum, row) => sum + pick(row), 0) / rows.length;

    expect(fallback.combat).toBeCloseTo(
      meanOf((w) => w.combat),
      12,
    );
    expect(fallback.vision).toBeCloseTo(
      meanOf((w) => w.vision),
      12,
    );
    expect(fallback.utility).toBeCloseTo(
      meanOf((w) => w.utility),
      12,
    );
  });

  test("jungle and utility carry their signature weight", () => {
    const jungle = weightsForRole("JUNGLE");
    expect(jungle.objective + jungle.vision).toBeCloseTo(0.42, 10);

    const utility = weightsForRole("UTILITY");
    expect(utility.vision + utility.utility).toBeCloseTo(0.48, 10);
  });
});

describe("computeMvp", () => {
  test("a playmaking support beats a high-KDA mid laner", () => {
    // The headline case, and the entire reason this is not a KDA ranking. If
    // this ever fails, the weights are wrong.
    const participants = buildLobby({
      // index 2 is MIDDLE on the winning team: a fed carry.
      2: {
        kills: 14,
        deaths: 2,
        assists: 9,
        totalDamageDealtToChampions: 35_000,
        visionScore: 15,
        totalHealsOnTeammates: 0,
        totalDamageShieldedOnTeammates: 0,
        timeCCingOthers: 10,
      },
      // index 4 is UTILITY on the same team: low kills, huge everything else.
      4: {
        kills: 2,
        deaths: 3,
        assists: 28,
        totalDamageDealtToChampions: 6000,
        visionScore: 90,
        totalHealsOnTeammates: 20_000,
        totalDamageShieldedOnTeammates: 10_000,
        timeCCingOthers: 120,
      },
    });

    const mvp = computeMvp(participants);
    expect(mvp?.puuid).toBe(puuidFor(4));
    expect(mvp?.role).toBe("UTILITY");
  });

  test("an objective-taking jungler beats an even top laner", () => {
    const participants = buildLobby({
      1: {
        kills: 4,
        deaths: 3,
        assists: 12,
        damageDealtToObjectives: 40_000,
        damageDealtToTurrets: 9000,
        dragonKills: 3,
        baronKills: 1,
        turretKills: 3,
        visionScore: 45,
      },
      0: { kills: 6, deaths: 6, assists: 6 },
    });

    const mvp = computeMvp(participants);
    expect(mvp?.puuid).toBe(puuidFor(1));
    expect(mvp?.role).toBe("JUNGLE");
  });

  test("is invariant to participant order", () => {
    const participants = buildLobby({
      4: {
        kills: 2,
        assists: 28,
        visionScore: 90,
        totalHealsOnTeammates: 20_000,
        timeCCingOthers: 120,
      },
    });

    const forward = computeMvp(participants);
    const reversed = computeMvp([...participants].reverse());
    expect(reversed?.puuid).toBe(forward?.puuid);
    expect(reversed?.score).toBe(forward?.score);
  });

  test("breaks exact ties on the smallest puuid, in either order", () => {
    // A perfectly symmetric lobby: every participant scores identically, so
    // only the tie-break can decide. Position-based tie-breaking would flip
    // between runs, because participant order is not stable across retries.
    const participants = buildLobby().map((p) =>
      RawParticipantSchema.parse({ ...p, win: true }),
    );

    const forward = computeMvp(participants);
    const reversed = computeMvp([...participants].reverse());

    expect(forward?.puuid).toBe(puuidFor(0));
    expect(reversed?.puuid).toBe(forward?.puuid);
  });

  test("a win breaks a tie in the winner's favour", () => {
    const participants = buildLobby();
    const mvp = computeMvp(participants);
    // Teams are statistically identical; team 100 won, and its lowest puuid is
    // index 0.
    expect(mvp?.puuid).toBe(puuidFor(0));
  });

  test("a win multiplier cannot rescue a genuinely bad game", () => {
    const participants = buildLobby({
      // Winning mid: dreadful.
      2: {
        kills: 2,
        deaths: 9,
        assists: 1,
        totalDamageDealtToChampions: 3000,
        visionScore: 4,
        damageDealtToObjectives: 0,
        damageDealtToTurrets: 0,
        turretKills: 0,
        damageSelfMitigated: 1000,
        timeCCingOthers: 0,
        totalHealsOnTeammates: 0,
        totalDamageShieldedOnTeammates: 0,
      },
      // Losing mid: dominant.
      7: {
        kills: 14,
        deaths: 1,
        assists: 8,
        totalDamageDealtToChampions: 40_000,
        visionScore: 40,
        damageDealtToObjectives: 20_000,
        damageDealtToTurrets: 6000,
        turretKills: 3,
      },
    });

    const mvp = computeMvp(participants);
    expect(mvp?.puuid).toBe(puuidFor(7));
  });

  test("falls back to individualPosition, then to DEFAULT, without throwing", () => {
    const blank = buildLobby({
      4: { teamPosition: "", individualPosition: "UTILITY" },
    });
    expect(computeMvp(blank)).toBeDefined();

    const invalid = buildLobby({
      4: { teamPosition: "Invalid", individualPosition: "UTILITY" },
    });
    const viaIndividual = computeMvp(invalid);
    expect(viaIndividual).toBeDefined();

    const unplaceable = buildLobby({
      4: { teamPosition: "", individualPosition: "Invalid" },
    });
    const scored = computeMvp(unplaceable);
    expect(scored).toBeDefined();
  });

  test("picks the same MVP with and without the challenges upgrade", () => {
    // The challenges path substitutes killParticipation, teamDamagePercentage,
    // and effectiveHealAndShielding. Fed the values consistent with the raw
    // stats, it must not change the answer.
    const withoutChallenges = buildLobby({
      4: {
        kills: 2,
        deaths: 3,
        assists: 28,
        totalDamageDealtToChampions: 6000,
        visionScore: 90,
        totalHealsOnTeammates: 20_000,
        totalDamageShieldedOnTeammates: 10_000,
        timeCCingOthers: 120,
      },
    });

    const teamTotals = new Map<number, { ka: number; damage: number }>();
    for (const teamId of [100, 200]) {
      const team = withoutChallenges.filter((p) => p.teamId === teamId);
      teamTotals.set(teamId, {
        ka: team.reduce((s, p) => s + p.kills + p.assists, 0),
        damage: team.reduce((s, p) => s + p.totalDamageDealtToChampions, 0),
      });
    }

    const withChallenges = withoutChallenges.map((p) => {
      const totals = teamTotals.get(p.teamId);
      if (totals === undefined) {
        throw new Error("missing team totals");
      }
      return RawParticipantSchema.parse({
        ...p,
        challenges: {
          ...makeChallenges(),
          killParticipation: (p.kills + p.assists) / totals.ka,
          teamDamagePercentage: p.totalDamageDealtToChampions / totals.damage,
          effectiveHealAndShielding:
            p.totalHealsOnTeammates + p.totalDamageShieldedOnTeammates,
        },
      });
    });

    expect(computeMvp(withChallenges)?.puuid).toBe(
      computeMvp(withoutChallenges)?.puuid,
    );
  });

  test("returns undefined for a lobby that is not a standard 5v5", () => {
    expect(computeMvp(buildLobby().slice(0, 9))).toBeUndefined();

    const lopsided = buildLobby().map((p, index) =>
      RawParticipantSchema.parse({
        ...p,
        teamId: index === 9 ? 100 : p.teamId,
      }),
    );
    expect(computeMvp(lopsided)).toBeUndefined();
  });

  test("scores a real ranked 5v5 and names one winner", () => {
    const mvp = computeMvp(riftFixture.info.participants);
    if (mvp === undefined) {
      throw new Error("a real ranked 5v5 should always produce an MVP");
    }

    const puuids = riftFixture.info.participants.map((p) => p.puuid);
    expect(puuids).toContain(mvp.puuid);
    expect(mvp.score).toBeGreaterThan(0);

    // Deterministic across repeated calls on identical input.
    expect(computeMvp(riftFixture.info.participants)?.puuid).toBe(mvp?.puuid);
  });
});

/** Minimal challenges block; the three fields under test are overridden by the
 * caller. */
function makeChallenges() {
  const [first] = riftFixture.info.participants;
  if (first?.challenges === undefined) {
    throw new Error("rift fixture should carry challenges");
  }
  return first.challenges;
}
