import type { RiotTeamId } from "@scout-for-lol/data";

type PendingPositionBase = {
  matchId: string;
  closesAt: Date;
  poolState: string;
};

export type PendingPosition =
  | (PendingPositionBase & {
      marketType: "outcome";
      gameAlias: string;
      teamId: RiotTeamId;
      /** WIN/LOSE for this game, or Blue/Red when both teams are tracked. */
      sideLabel: string;
      offeredStake: number;
      matchedStake: number | null;
      unmatchedStake: number | null;
    })
  | (PendingPositionBase & {
      marketType: "parlay";
      subjectAlias: string;
      side: "YES" | "NO";
      stake: number;
    });
