import type { RawParticipant } from "@scout-for-lol/data";
import { PARTICIPANTS_PER_TEAM } from "#src/betting/constants.ts";
import { isStandardLobby } from "#src/betting/eligibility.ts";

/**
 * Who carried the game, across all ten participants.
 *
 * Deliberately NOT KDA alone. A support who wards the map and keeps the carry
 * alive, or a jungler who takes every objective, contributes as much as a mid
 * laner with a fat kill count — but only the mid laner shows up in a KDA
 * ranking. So the score is a weighted blend of six contributions, and the
 * weights depend on the role the player actually played.
 *
 * This operates on `RawParticipant` rather than the `CompletedMatch` domain
 * model because `toMatch()` discards almost everything it needs: objective
 * damage, heals and shields on teammates, crowd control, self-mitigated
 * damage, and `teamPosition` are all dropped on the way in. The raw match is
 * in hand throughout post-match processing, so nothing extra is fetched.
 *
 * The existing `findMvpIndex` in the report package is a different function
 * answering a different question (which *tracked* player gets the splash art)
 * and is left alone.
 */

export type MvpRole =
  | "TOP"
  | "JUNGLE"
  | "MIDDLE"
  | "BOTTOM"
  | "UTILITY"
  | "DEFAULT";

export type MvpComponents = {
  combat: number;
  damage: number;
  objective: number;
  vision: number;
  utility: number;
  survival: number;
};

export type MvpScore = {
  puuid: string;
  role: MvpRole;
  score: number;
  components: MvpComponents;
};

const REAL_ROLES = [
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
] as const satisfies readonly Exclude<MvpRole, "DEFAULT">[];

/**
 * Each row sums to 1.0, so a score is directly comparable across roles.
 *
 * Jungle carries 0.42 across objective and vision; utility carries 0.48 across
 * vision and utility. Those are the levers that let a 2/3/28 support with 90
 * vision score beat a 14/2/9 mid laner — which is the behaviour this whole
 * table exists to produce.
 */
const ROLE_WEIGHTS: Record<Exclude<MvpRole, "DEFAULT">, MvpComponents> = {
  TOP: {
    combat: 0.34,
    damage: 0.24,
    objective: 0.18,
    vision: 0.06,
    utility: 0.04,
    survival: 0.14,
  },
  JUNGLE: {
    combat: 0.3,
    damage: 0.18,
    objective: 0.28,
    vision: 0.14,
    utility: 0.04,
    survival: 0.06,
  },
  MIDDLE: {
    combat: 0.36,
    damage: 0.34,
    objective: 0.14,
    vision: 0.08,
    utility: 0.04,
    survival: 0.04,
  },
  BOTTOM: {
    combat: 0.34,
    damage: 0.38,
    objective: 0.16,
    vision: 0.06,
    utility: 0.02,
    survival: 0.04,
  },
  UTILITY: {
    combat: 0.3,
    damage: 0.1,
    objective: 0.06,
    vision: 0.24,
    utility: 0.24,
    survival: 0.06,
  },
};

const COMPONENT_KEYS = [
  "combat",
  "damage",
  "objective",
  "vision",
  "utility",
  "survival",
] as const satisfies readonly (keyof MvpComponents)[];

/**
 * The fallback row is the column-wise mean of the five real roles, derived
 * rather than hand-typed so it cannot drift out of step when a weight is
 * retuned. It applies when Riot reports no usable position, which happens for
 * remakes and the occasional broken record.
 */
function meanWeights(): MvpComponents {
  const rows = REAL_ROLES.map((role) => ROLE_WEIGHTS[role]);
  const mean = (key: keyof MvpComponents): number =>
    rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  return {
    combat: mean("combat"),
    damage: mean("damage"),
    objective: mean("objective"),
    vision: mean("vision"),
    utility: mean("utility"),
    survival: mean("survival"),
  };
}

const DEFAULT_WEIGHTS = meanWeights();

export function weightsForRole(role: MvpRole): MvpComponents {
  if (role === "DEFAULT") {
    return DEFAULT_WEIGHTS;
  }
  return ROLE_WEIGHTS[role];
}

/**
 * A win is worth a 15% multiplier: enough to break a realistic tie in the
 * winner's favour, but not enough to let a 2/9 winner outrank a 14/1 loser.
 */
const WIN_MULTIPLIER = 1.15;

/** Ceiling on any single normalized component, so one runaway statistic
 * cannot dominate the blend. */
const MAX_RELATIVE = 3;

/** Scores are compared at six decimal places so exact ties are actually
 * reachable and the tie-break below is deterministic across platforms. */
const SCORE_PRECISION = 1e6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * A participant's share of their own team's total, rescaled so that 1.0 means
 * "exactly your fifth".
 *
 * Share rather than raw value because raw statistics are not comparable across
 * game length, patch, or rank — a 45-minute game inflates every absolute
 * number. A share needs no recalibration when Riot changes gold curves.
 */
function relativeShare(value: number, teamTotal: number): number {
  return clamp(
    (value / Math.max(teamTotal, 1)) * PARTICIPANTS_PER_TEAM,
    0,
    MAX_RELATIVE,
  );
}

function resolveRole(participant: RawParticipant): MvpRole {
  const candidates = [participant.teamPosition, participant.individualPosition];
  for (const candidate of candidates) {
    for (const role of REAL_ROLES) {
      if (candidate === role) {
        return role;
      }
    }
  }
  // PositionSchema admits "" and "Invalid"; neither is an error worth throwing
  // over, so an unplaceable participant is scored with the average weights.
  return "DEFAULT";
}

/**
 * Which of Riot's richer `challenges` metrics this match can use.
 *
 * Decided once for the whole match, all-or-nothing per metric. `challenges` is
 * optional on a participant and two of these fields are optional within it, so
 * a mixed lobby would put some players on a percentage scale and others on a
 * team-share scale — silently corrupting exactly the comparison this function
 * exists to make.
 */
type ChallengeUpgrades = {
  killParticipation: boolean;
  teamDamagePercentage: boolean;
  effectiveHealAndShielding: boolean;
};

function resolveUpgrades(
  participants: readonly RawParticipant[],
): ChallengeUpgrades {
  return {
    killParticipation: participants.every(
      (p) => p.challenges?.killParticipation !== undefined,
    ),
    teamDamagePercentage: participants.every(
      (p) => p.challenges?.teamDamagePercentage !== undefined,
    ),
    effectiveHealAndShielding: participants.every(
      (p) => p.challenges?.effectiveHealAndShielding !== undefined,
    ),
  };
}

function healingAndShielding(
  participant: RawParticipant,
  upgrades: ChallengeUpgrades,
): number {
  const effective = participant.challenges?.effectiveHealAndShielding;
  if (effective !== undefined && upgrades.effectiveHealAndShielding) {
    // Excludes self-healing, which is what we actually want to reward here.
    return effective;
  }
  return (
    participant.totalHealsOnTeammates +
    participant.totalDamageShieldedOnTeammates
  );
}

function objectiveDamage(participant: RawParticipant): number {
  return participant.damageDealtToObjectives + participant.damageDealtToTurrets;
}

function objectiveTakedowns(participant: RawParticipant): number {
  return (
    participant.dragonKills + participant.baronKills + participant.turretKills
  );
}

type TeamTotals = {
  killsAndAssists: number;
  deaths: number;
  damageToChampions: number;
  objectiveDamage: number;
  objectiveTakedowns: number;
  visionScore: number;
  healingAndShielding: number;
  crowdControl: number;
  selfMitigated: number;
};

function sumTeam(
  members: readonly RawParticipant[],
  upgrades: ChallengeUpgrades,
): TeamTotals {
  return members.reduce<TeamTotals>(
    (totals, p) => ({
      killsAndAssists: totals.killsAndAssists + p.kills + p.assists,
      deaths: totals.deaths + p.deaths,
      damageToChampions:
        totals.damageToChampions + p.totalDamageDealtToChampions,
      objectiveDamage: totals.objectiveDamage + objectiveDamage(p),
      objectiveTakedowns: totals.objectiveTakedowns + objectiveTakedowns(p),
      visionScore: totals.visionScore + p.visionScore,
      healingAndShielding:
        totals.healingAndShielding + healingAndShielding(p, upgrades),
      crowdControl: totals.crowdControl + p.timeCCingOthers,
      selfMitigated: totals.selfMitigated + p.damageSelfMitigated,
    }),
    {
      killsAndAssists: 0,
      deaths: 0,
      damageToChampions: 0,
      objectiveDamage: 0,
      objectiveTakedowns: 0,
      visionScore: 0,
      healingAndShielding: 0,
      crowdControl: 0,
      selfMitigated: 0,
    },
  );
}

function combatScore(
  participant: RawParticipant,
  totals: TeamTotals,
  upgrades: ChallengeUpgrades,
): number {
  const reported = participant.challenges?.killParticipation;
  const participation =
    reported !== undefined && upgrades.killParticipation
      ? clamp(reported * 2.5, 0, MAX_RELATIVE)
      : relativeShare(
          participant.kills + participant.assists,
          totals.killsAndAssists,
        );

  // Dying less than your share is worth more, so the death term is inverted
  // around the "fair share" value of 1.0.
  const deathScore = clamp(
    2 - relativeShare(participant.deaths, totals.deaths),
    0,
    MAX_RELATIVE,
  );

  return 0.6 * participation + 0.4 * deathScore;
}

function damageScore(
  participant: RawParticipant,
  totals: TeamTotals,
  upgrades: ChallengeUpgrades,
): number {
  const reported = participant.challenges?.teamDamagePercentage;
  if (reported !== undefined && upgrades.teamDamagePercentage) {
    return clamp(reported * PARTICIPANTS_PER_TEAM, 0, MAX_RELATIVE);
  }
  return relativeShare(
    participant.totalDamageDealtToChampions,
    totals.damageToChampions,
  );
}

function componentsFor(
  participant: RawParticipant,
  totals: TeamTotals,
  upgrades: ChallengeUpgrades,
): MvpComponents {
  return {
    combat: combatScore(participant, totals, upgrades),
    damage: damageScore(participant, totals, upgrades),
    objective:
      0.7 *
        relativeShare(objectiveDamage(participant), totals.objectiveDamage) +
      0.3 *
        relativeShare(
          objectiveTakedowns(participant),
          totals.objectiveTakedowns,
        ),
    vision: relativeShare(participant.visionScore, totals.visionScore),
    utility:
      0.6 *
        relativeShare(
          healingAndShielding(participant, upgrades),
          totals.healingAndShielding,
        ) +
      0.4 * relativeShare(participant.timeCCingOthers, totals.crowdControl),
    survival: relativeShare(
      participant.damageSelfMitigated,
      totals.selfMitigated,
    ),
  };
}

function scoreParticipant(
  participant: RawParticipant,
  totals: TeamTotals,
  upgrades: ChallengeUpgrades,
): MvpScore {
  const role = resolveRole(participant);
  const components = componentsFor(participant, totals, upgrades);
  const weights = weightsForRole(role);

  const weighted = COMPONENT_KEYS.reduce(
    (sum, key) => sum + components[key] * weights[key],
    0,
  );
  const raw = weighted * (participant.win ? WIN_MULTIPLIER : 1);

  return {
    puuid: participant.puuid,
    role,
    score: Math.round(raw * SCORE_PRECISION) / SCORE_PRECISION,
    components,
  };
}

/**
 * Score every participant and return the best.
 *
 * Returns undefined for anything that is not a standard 5v5 — the weights are
 * calibrated for Summoner's Rift lane economy, and ARAM has no comparable
 * vision or objective game to compare roles across. Callers additionally gate
 * on queue and duration via `isBettableGame` and `classifyMatchForBetting`.
 *
 * Ties break on the lexicographically smallest PUUID, following the same
 * reasoning as `findMvpIndex` in the report package: participant order is not
 * guaranteed stable across retries, so position-based tie-breaking would let
 * the awarded MVP flip between two runs over the same match.
 */
export function computeMvp(
  participants: readonly RawParticipant[],
): MvpScore | undefined {
  if (!isStandardLobby(participants)) {
    return undefined;
  }

  const upgrades = resolveUpgrades(participants);
  const totalsByTeam = new Map<number, TeamTotals>();
  for (const teamId of new Set(participants.map((p) => p.teamId))) {
    totalsByTeam.set(
      teamId,
      sumTeam(
        participants.filter((p) => p.teamId === teamId),
        upgrades,
      ),
    );
  }

  let best: MvpScore | undefined;
  for (const participant of participants) {
    const totals = totalsByTeam.get(participant.teamId);
    if (totals === undefined) {
      continue;
    }
    const candidate = scoreParticipant(participant, totals, upgrades);
    if (
      best === undefined ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.puuid < best.puuid)
    ) {
      best = candidate;
    }
  }
  return best;
}
