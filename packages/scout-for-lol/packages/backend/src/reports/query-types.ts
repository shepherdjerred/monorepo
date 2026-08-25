import type {
  ReportQueryPlan,
  VisualizationSnapshot,
} from "@scout-for-lol/data";

/**
 * The report query layer's result contract.
 *
 * `query-engine.ts` orchestrates aggregation, temporal comparison and
 * visualisation, and each of those modules consumes these shapes while the
 * engine imports their entry points back. Declaring the contract in its own
 * module is what keeps that from being an import cycle.
 */

export type ReportResultValue = {
  column: string;
  value: number | string | null;
  comparisonValue?: number | string | null;
  absoluteDelta?: number | null;
  percentageDelta?: number | null;
  comparisonSampleSize?: number;
  comparisonGames?: number;
  comparisonSuccesses?: number;
  comparisonNumerator?: number;
  comparisonDenominator?: number;
  sampleSize?: number;
  games?: number;
  successes?: number;
  numerator?: number;
  denominator?: number;
};

export type ReportMentionIdentity =
  | {
      kind: "player";
      playerId: number | null;
      alias: string;
      discordId: string | null;
    }
  | {
      kind: "group";
      members: { playerId: number; alias: string }[];
    };

export type ReportResultRow = {
  label: string;
  dimensions: string[];
  mentionIdentity: ReportMentionIdentity | null;
  values: ReportResultValue[];
};

export type ReportQueryResult = {
  plan: ReportQueryPlan;
  columns: string[];
  rows: ReportResultRow[];
  rowsScanned: number;
  comparisonRows?: ReportResultRow[];
  visualization?: VisualizationSnapshot;
  evidence?: {
    label: string;
    games: number;
    values: {
      column: string;
      sampleSize: number;
      successes?: number;
      numerator?: number;
      denominator?: number;
    }[];
  }[];
};

export type AggregateRow = {
  label: string;
  playerId: number | null;
  discordId: string | null;
  groupMembers: { playerId: number; alias: string }[] | null;
  games: number;
  wins: number;
  surrenders: number;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  damageToChampions: number;
  goldEarned: number;
  visionScore: number;
  damageTaken: number;
  totalDamageDealt: number;
  wardsPlaced: number;
  multikills: number;
  /** Sum of game durations (seconds), counted once per group row per game. */
  durationSeconds: number;
  /** Sum of time played (seconds) across group members. */
  timePlayedSeconds: number;
  participantRows: number;
  earlySurrenders: number;
  laneMinions: number;
  neutralMinions: number;
  goldSpent: number;
  damageMitigated: number;
  damageToObjectives: number;
  damageToTurrets: number;
  healing: number;
  teammateHealing: number;
  wardsKilled: number;
  controlWardsBought: number;
  detectorWardsPlaced: number;
  doubleKills: number;
  tripleKills: number;
  quadraKills: number;
  pentaKills: number;
  largestMultikill: number;
  killingSprees: number;
  firstBloods: number;
  championLevelTotal: number;
  championExperienceTotal: number;
  timeDeadSeconds: number;
  longestLifeSeconds: number;
  ccTimeSeconds: number;
  turretKills: number;
  inhibitorKills: number;
  dragonKills: number;
  baronKills: number;
  arenaRows: number;
  placementSum: number;
  topTwoPlacements: number;
  firstPlaceFinishes: number;
};
