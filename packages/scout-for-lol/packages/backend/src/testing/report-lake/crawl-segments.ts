import path from "node:path";
import { z } from "zod";
import { LeaguePuuidSchema, RiotMatchIdSchema } from "@scout-for-lol/data";
import type { CrawlRecord } from "#src/league/crawl/crawl-records.ts";
import {
  encodeSegment,
  type EncodedSegment,
} from "#src/league/crawl/crawl-segment.ts";
import type {
  CommittedCrawlSegment,
  CrawlSegmentSource,
} from "#src/report-lake/crawl/crawl-sources.ts";

/**
 * Crawl segments for lake tests, built from a real Summoner's Rift Match-V5
 * document (`league/tasks/postmatch/testdata/match-clash-s3.json`) moved to
 * ranked solo with its match id swapped, so each test match is distinct but
 * parses like a crawled one.
 */

const FIXTURE = path.resolve(
  import.meta.dirname,
  "../../league/tasks/postmatch/testdata/match-clash-s3.json",
);

const FixtureSchema = z.looseObject({
  metadata: z.looseObject({
    matchId: z.string(),
    participants: z.array(z.string()),
  }),
  info: z.looseObject({
    participants: z.array(
      z.looseObject({ puuid: z.string(), participantId: z.number() }),
    ),
  }),
});

let fixture: z.infer<typeof FixtureSchema> | undefined;

async function loadFixture(): Promise<z.infer<typeof FixtureSchema>> {
  fixture ??= FixtureSchema.parse(await Bun.file(FIXTURE).json());
  return fixture;
}

/** The fixture's participant PUUIDs, in participant order. */
export async function crawlFixturePuuids(): Promise<string[]> {
  const loaded = await loadFixture();
  return loaded.info.participants.map((participant) => participant.puuid);
}

/** Both checkpoints, on frames stamped just before them as Riot's are. */
const CHECKPOINTS = [
  { atMs: 600_000, frameMs: 540_219 },
  { atMs: 900_000, frameMs: 840_295 },
] as const;

export type CrawlRecordOptions = {
  crawledAt?: string;
  withTimeline?: boolean;
  /**
   * Swap the last participant for this PUUID everywhere the record names
   * them, so a test can erase one match's player without touching the rest.
   */
  player?: string;
};

/** A fixed 78-character PUUID no fixture participant has. */
export function distinctCrawlPuuid(name: string): string {
  return `erasure-test-${name}`.padEnd(78, "0");
}

export async function crawlRecord(
  matchId: string,
  options: CrawlRecordOptions = {},
): Promise<CrawlRecord> {
  const loaded = await loadFixture();
  const last = loaded.info.participants.at(-1)?.puuid;
  const swap = (puuid: string) =>
    puuid === last && options.player !== undefined ? options.player : puuid;
  const match = structuredClone({
    ...loaded,
    metadata: {
      ...loaded.metadata,
      matchId,
      participants: loaded.metadata.participants.map((puuid) => swap(puuid)),
    },
    info: {
      ...loaded.info,
      queueId: 420,
      participants: loaded.info.participants.map((participant) => ({
        ...participant,
        puuid: swap(participant.puuid),
      })),
    },
  });
  const participants = loaded.info.participants.map((participant) => ({
    participantId: participant.participantId,
    puuid: LeaguePuuidSchema.parse(swap(participant.puuid)),
  }));
  const [first] = participants;
  if (first === undefined) throw new Error("fixture has no participants");
  return {
    v: 1,
    matchId: RiotMatchIdSchema.parse(matchId),
    platform: "NA1",
    crawledAt: options.crawledAt ?? "2026-11-14T12:00:00.000Z",
    depth: 1,
    visited: { puuid: first.puuid, tier: "GOLD", division: "II" },
    match,
    timeline:
      options.withTimeline === false
        ? null
        : {
            participants,
            events: [
              {
                t: 1500,
                type: "ITEM_PURCHASED",
                participantId: 1,
                itemId: 1055,
              },
              {
                t: 64_000,
                type: "SKILL_LEVEL_UP",
                participantId: 2,
                skillSlot: 1,
                levelUpType: "NORMAL",
              },
            ],
            checkpoints: CHECKPOINTS.map(({ atMs, frameMs }) => ({
              atMs,
              frameMs,
              participants: participants.map(({ participantId }) => ({
                participantId,
                totalGold: atMs / 100 + participantId * 50,
                xp: atMs / 50 + participantId * 20,
                minions: atMs / 5000 + participantId,
              })),
            })),
          },
  };
}

export async function crawlSegment(
  dt: string,
  matchIds: readonly string[],
  options: { withTimeline?: boolean } = {},
): Promise<EncodedSegment> {
  const records = await Promise.all(
    matchIds.map(async (matchId) => await crawlRecord(matchId, options)),
  );
  return encodeSegment({ route: "na1", dt, records });
}

/** A segment of matches, each optionally naming its own extra player. */
export async function crawlSegmentOf(
  dt: string,
  matches: readonly {
    matchId: z.input<typeof RiotMatchIdSchema>;
    player?: string;
  }[],
): Promise<EncodedSegment> {
  const records = await Promise.all(
    matches.map(
      async ({ matchId, player }) =>
        await crawlRecord(matchId, player === undefined ? {} : { player }),
    ),
  );
  return encodeSegment({ route: "na1", dt, records });
}

/** A committed-segment source over in-memory segments, as PostgreSQL and S3 would serve them. */
export function memoryCrawlSegmentSource(
  segments: readonly EncodedSegment[],
): CrawlSegmentSource & { reads: string[] } {
  const reads: string[] = [];
  const committed: CommittedCrawlSegment[] = segments.map((segment) => ({
    sha256: segment.sha256,
    objectKey: segment.objectKey,
    dt: segment.dt,
  }));
  return {
    reads,
    segmentsSince: (sinceDay) =>
      Promise.resolve(committed.filter((segment) => segment.dt >= sinceDay)),
    read: (segment) => {
      reads.push(segment.sha256);
      const found = segments.find(
        (candidate) => candidate.sha256 === segment.sha256,
      );
      return found === undefined
        ? Promise.reject(new Error(`no segment ${segment.sha256}`))
        : Promise.resolve(found.bytes);
    },
  };
}
