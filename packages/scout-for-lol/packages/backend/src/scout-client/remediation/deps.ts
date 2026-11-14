import type { RawMatch, RawTimeline } from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";

export type RemediationDeps = {
  readonly riot: {
    readonly fetchMatch: (
      matchId: RiotMatchId,
    ) => Promise<RawMatch | undefined>;
    readonly fetchTimeline: (
      matchId: RiotMatchId,
    ) => Promise<RawTimeline | undefined>;
  };
  /** Deleting a key that does not exist must succeed. */
  readonly objects: { readonly delete: (key: string) => Promise<void> };
  readonly ingestMatch: (
    match: RawMatch,
    trackedPlayerAliases: string[],
  ) => Promise<void>;
  readonly ingestTimeline: (
    timeline: RawTimeline,
    trackedPlayerAliases: string[],
    gameCreatedAt: Date,
  ) => Promise<void>;
  /** The existing device revoke path. */
  readonly revokeDevice: (
    deviceId: string,
    ownerId: string,
  ) => Promise<boolean>;
  readonly refresh: {
    readonly rebuildLake: () => Promise<void>;
    readonly refreshHallOfFame: () => Promise<void>;
    readonly refreshCompetitions: () => Promise<void>;
  };
  readonly log?: (line: string) => void;
};
