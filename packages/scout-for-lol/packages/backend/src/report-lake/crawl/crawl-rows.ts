import { createHash } from "node:crypto";
import {
  RawMatchSchema,
  RiotMatchIdSchema,
  type RawMatch,
  type RiotMatchId,
} from "@scout-for-lol/data";
import { z } from "zod";
import { puuidHash } from "#src/league/crawl/crawl-config.ts";
import { ReducedTimelineSchema } from "#src/league/crawl/crawl-records.ts";
import { decodeSegment } from "#src/league/crawl/crawl-segment.ts";
import {
  flattenMatch,
  flattenMatchTeamBans,
  flattenMatchTeams,
} from "#src/report-lake/flatten.ts";
import { lakeTimestamp } from "#src/report-lake/schema.ts";
import {
  emptyCrawlTableRows,
  type CrawlTableRows,
} from "#src/report-lake/crawl/crawl-lake-schema.ts";

/**
 * Raw crawl segments to crawl-table rows.
 *
 * A segment line is a `CrawlRecord` (schema v1, `league/crawl/crawl-records.ts`):
 * the untouched Match-V5 document, the visited player's bracket, and for a
 * sampled match the timeline reduced to item and skill events and the 10- and 15-minute checkpoints. This is the
 * one reader of those lines, shared by the inbox fold and a day rebuild, so
 * both produce the same rows from the same bytes.
 */

/** SHA-256 hashes of erased PUUIDs, as `ErasedPuuid` stores them. */
export type ErasedPuuidHashes = ReadonlySet<string>;

const CrawlRecordLineSchema = z.object({
  v: z.literal(1),
  matchId: z.string().min(1),
  platform: z.string().min(1),
  crawledAt: z.iso.datetime(),
  depth: z.number().int().nonnegative(),
  visited: z.object({
    puuid: z.string().min(1),
    tier: z.string().nullable(),
    division: z.string().nullable(),
  }),
  match: z.unknown(),
  timeline: ReducedTimelineSchema.nullable(),
});

type CrawlRecordLine = z.infer<typeof CrawlRecordLineSchema>;

export type CrawlSegmentRecord = {
  line: CrawlRecordLine;
  match: RawMatch;
};

export type DecodedCrawlSegment = {
  records: CrawlSegmentRecord[];
  /** Records left out because they name an erased player. */
  erased: number;
  /** Records whose match document is not a valid Match-V5 document. */
  invalid: number;
};

/** The SHA-256 a segment is named by, checked against its bytes. */
export function segmentSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function namesErasedPlayer(
  line: CrawlRecordLine,
  match: RawMatch,
  erased: ErasedPuuidHashes,
): boolean {
  if (erased.size === 0) return false;
  const puuids = [
    line.visited.puuid,
    ...match.info.participants.flatMap((participant) =>
      participant.puuid === null ? [] : [participant.puuid],
    ),
    ...(line.timeline?.participants.map((participant) => participant.puuid) ??
      []),
  ];
  return puuids.some((puuid) => erased.has(puuidHash(puuid)));
}

/** The Match-V5 places a PUUID can appear, read without requiring a valid document. */
const MatchPuuidsSchema = z.looseObject({
  metadata: z
    .looseObject({ participants: z.array(z.string()).optional() })
    .optional(),
  info: z
    .looseObject({
      participants: z
        .array(z.looseObject({ puuid: z.string().nullable().optional() }))
        .optional(),
    })
    .optional(),
});

/**
 * Every PUUID one raw segment line names: the visited player, the match
 * document's metadata and participants, and the reduced timeline's players.
 *
 * The erasure sweep uses this on lines the lake would skip as invalid Match-V5
 * documents too, so a document Riot shaped differently is still checked. A
 * line that is not a crawl record at all is the crawl writer's broken
 * contract and fails.
 */
export function crawlLinePuuids(raw: unknown): {
  matchId: RiotMatchId;
  puuids: string[];
} {
  const line = CrawlRecordLineSchema.parse(raw);
  const match = MatchPuuidsSchema.safeParse(line.match);
  const documentPuuids = match.success
    ? [
        ...(match.data.metadata?.participants ?? []),
        ...(match.data.info?.participants ?? []).flatMap((participant) =>
          typeof participant.puuid === "string" ? [participant.puuid] : [],
        ),
      ]
    : [];
  return {
    matchId: RiotMatchIdSchema.parse(line.matchId),
    puuids: [
      line.visited.puuid,
      ...documentPuuids,
      ...(line.timeline?.participants.map((participant) => participant.puuid) ??
        []),
    ],
  };
}

/**
 * Decode one segment, dropping every match that names an erased player.
 *
 * A malformed line is a broken contract with the crawl's own writer and fails
 * the read; a match document Riot shaped differently from `RawMatchSchema` is
 * counted and skipped, as the tracked rebuild skips one.
 */
export function readCrawlSegment(
  bytes: Uint8Array,
  erased: ErasedPuuidHashes,
): DecodedCrawlSegment {
  const decoded: DecodedCrawlSegment = { records: [], erased: 0, invalid: 0 };
  for (const raw of decodeSegment(bytes)) {
    const line = CrawlRecordLineSchema.parse(raw);
    const parsed = RawMatchSchema.safeParse(line.match);
    if (!parsed.success) {
      decoded.invalid += 1;
      continue;
    }
    if (namesErasedPlayer(line, parsed.data, erased)) {
      decoded.erased += 1;
      continue;
    }
    decoded.records.push({ line, match: parsed.data });
  }
  return decoded;
}

function timelineRows(
  line: CrawlRecordLine,
  ingestDay: string,
): Pick<
  CrawlTableRows,
  | "timeline_events_crawl"
  | "timeline_event_participants_crawl"
  | "timeline_checkpoints_crawl"
> {
  const events: object[] = [];
  const eventParticipants: object[] = [];
  const checkpoints: object[] = [];
  const rows = {
    timeline_events_crawl: events,
    timeline_event_participants_crawl: eventParticipants,
    timeline_checkpoints_crawl: checkpoints,
  };
  if (line.timeline === null) return rows;
  const puuidByParticipant = new Map(
    line.timeline.participants.map((participant) => [
      participant.participantId,
      participant.puuid,
    ]),
  );
  for (const checkpoint of line.timeline.checkpoints ?? []) {
    for (const participant of checkpoint.participants) {
      checkpoints.push({
        match_id: line.matchId,
        ingest_day: ingestDay,
        checkpoint_ms: checkpoint.atMs,
        frame_timestamp_ms: checkpoint.frameMs,
        participant_id: participant.participantId,
        puuid: puuidByParticipant.get(participant.participantId) ?? null,
        total_gold: participant.totalGold,
        xp: participant.xp,
        minions: participant.minions,
      });
    }
  }
  for (const [index, event] of line.timeline.events.entries()) {
    // The reduced timeline has no frames, so the id names the event by its
    // position in the reduced list, never colliding with a tracked
    // `<match>:<frame>:<index>` id.
    const eventId = `${line.matchId}:r:${index.toString()}`;
    rows.timeline_events_crawl.push({
      event_id: eventId,
      match_id: line.matchId,
      ingest_day: ingestDay,
      event_index: index,
      event_timestamp_ms: event.t,
      event_type: event.type,
      participant_id: event.participantId,
      item_id: event.itemId ?? null,
      after_id: event.afterId ?? null,
      before_id: event.beforeId ?? null,
      skill_slot: event.skillSlot ?? null,
      gold_gain: event.goldGain ?? null,
      level_up_type: event.levelUpType ?? null,
    });
    if (event.participantId !== null) {
      rows.timeline_event_participants_crawl.push({
        event_id: eventId,
        match_id: line.matchId,
        ingest_day: ingestDay,
        participant_id: event.participantId,
        puuid: puuidByParticipant.get(event.participantId) ?? null,
        role: "subject",
        role_index: 0,
      });
    }
  }
  return rows;
}

/** Every crawl-table row one stored match produces, for one ingest day. */
export function flattenCrawlRecord(
  record: CrawlSegmentRecord,
  ingestDay: string,
): CrawlTableRows {
  const { line, match } = record;
  const crawl = {
    ingest_day: ingestDay,
    crawled_at: lakeTimestamp(Date.parse(line.crawledAt)),
    crawl_depth: line.depth,
    bracket_tier: line.visited.tier,
    bracket_division: line.visited.division,
  };
  const day = { ingest_day: ingestDay };
  return {
    ...emptyCrawlTableRows(),
    matches_crawl: flattenMatch(match).map((row) => ({ ...row, ...crawl })),
    match_teams_crawl: flattenMatchTeams(match).map((row) => ({
      ...row,
      ...day,
    })),
    match_team_bans_crawl: flattenMatchTeamBans(match).map((row) => ({
      ...row,
      ...day,
    })),
    ...timelineRows(line, ingestDay),
  };
}
