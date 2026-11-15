import type { LeaguePuuid, RiotMatchId } from "@scout-for-lol/data";
import type { EncodedSegment } from "./crawl-segment.ts";

/**
 * The crawl's durable state. The orchestrator (`crawl-run.ts`) talks only to
 * this interface; `crawl-prisma-store.ts` is the PostgreSQL implementation.
 */

export type NewFrontierPlayer = {
  puuid: LeaguePuuid;
  platformRoute: string;
  depth: number;
  seedMatchId: RiotMatchId;
};

export type FrontierPlayer = {
  puuid: LeaguePuuid;
  platformRoute: string;
  depth: number;
};

/** `matchId` is `null` until the first tracked observation has been read. */
export type SeedCursor = { observedAt: Date; matchId: RiotMatchId | null };

export type TrackedObservation = {
  riotMatchId: RiotMatchId;
  matchObjectKey: string;
  observedAt: Date;
};

export type StoredMatchRow = {
  riotMatchId: RiotMatchId;
  platformRoute: string;
  queueId: number;
  gameCreatedAt: Date;
  depth: number;
  visitedPuuid: LeaguePuuid;
  timelineSampled: boolean;
};

export type CommitInput = {
  now: Date;
  segments: { segment: EncodedSegment; matches: StoredMatchRow[] }[];
  /** Players whose visit completed, with the bracket from this visit. */
  visits: {
    puuid: LeaguePuuid;
    rank: { tier: string; division: string } | null;
  }[];
  /** Participants of the stored matches, one level deeper. */
  children: NewFrontierPlayer[];
};

export type CrawlStore = {
  seedCursor: (now: Date) => Promise<SeedCursor>;
  observationsAfter: (
    cursor: SeedCursor,
    since: Date,
    limit: number,
  ) => Promise<TrackedObservation[]>;
  advanceSeedCursor: (cursor: SeedCursor) => Promise<void>;
  /** Admit players to the frontier, refusing erased ones; existing rows keep their state. */
  admit: (
    players: readonly NewFrontierPlayer[],
    now: Date,
  ) => Promise<{ admitted: number; erased: number }>;
  /** Players whose cooldown has ended and who are not erased, shallowest first. */
  claimEligible: (now: Date, limit: number) => Promise<FrontierPlayer[]>;
  /** The subset of `puuids` that are erased. */
  erasedAmong: (puuids: readonly LeaguePuuid[]) => Promise<Set<LeaguePuuid>>;
  /** The subset of `matchIds` the crawl has not stored. */
  unknownMatchIds: (matchIds: readonly RiotMatchId[]) => Promise<RiotMatchId[]>;
  matchesCrawledSince: (since: Date) => Promise<number>;
  /** Segments, their matches, completed visits and child admissions, atomically. */
  commit: (input: CommitInput) => Promise<void>;
  frontierSizeByDepth: () => Promise<Record<number, number>>;
};

/** Raw-object access the crawl needs: read a tracked match, write a segment. */
export type CrawlObjectStore = {
  readText: (key: string) => Promise<string>;
  putSegment: (segment: EncodedSegment) => Promise<void>;
};
