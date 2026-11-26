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
  /** The match that surfaced the player. Not persisted: the frontier keeps only what scheduling reads. */
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
  /**
   * The erasure count read when the tick started (`erasureMark`). The commit
   * refuses with `CrawlErasureFenceError` when an erasure landed since, so a
   * match checked against the older list is never committed after it.
   */
  erasureMark: number;
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
  /** How many players are erased; read before the tick checks any of them. */
  erasureMark: () => Promise<number>;
  /** Segments, their matches, completed visits and child admissions, atomically. */
  commit: (input: CommitInput) => Promise<void>;
  /** Queue written-but-uncommitted crawl objects for the erasure sweep to delete. */
  queueObjectDeletions: (objectKeys: readonly string[]) => Promise<void>;
  frontierSizeByDepth: () => Promise<Record<number, number>>;
};

/** Raw-object access the crawl needs: read a tracked match, write a segment. */
export type CrawlObjectStore = {
  readText: (key: string) => Promise<string>;
  putSegment: (segment: EncodedSegment) => Promise<void>;
};

/**
 * An erasure was recorded while the tick ran. The tick's matches were checked
 * against the erased list before it, so committing them could store a match
 * that names the newly erased player after the erasure sweep has passed it.
 */
export class CrawlErasureFenceError extends Error {
  constructor() {
    super(
      "A player was erased while this crawl tick ran; its segments are discarded and the next tick re-checks every match",
    );
    this.name = "CrawlErasureFenceError";
  }
}
