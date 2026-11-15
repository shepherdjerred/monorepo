import { LeaguePuuidSchema, RiotMatchIdSchema } from "@scout-for-lol/data";
import type { LeaguePuuid, RiotMatchId } from "@scout-for-lol/data";
import { z } from "zod";
import { CRAWL_MAP_ID, CRAWL_QUEUE_IDS } from "./crawl-config.ts";

/**
 * The few Match-V5 fields the crawl itself reads. Everything else in the
 * payload is stored untouched for the later lake fold, so the crawl does not
 * reject a match over fields it does not use.
 */
const CrawlMatchEnvelopeSchema = z.object({
  metadata: z.object({ matchId: RiotMatchIdSchema }),
  info: z.object({
    queueId: z.number().int(),
    mapId: z.number().int(),
    gameCreation: z.number().int().positive(),
    participants: z.array(z.object({ puuid: LeaguePuuidSchema })).min(1),
  }),
});
export type CrawlMatchEnvelope = z.infer<typeof CrawlMatchEnvelopeSchema>;

export function parseCrawlMatchEnvelope(raw: unknown): CrawlMatchEnvelope {
  return CrawlMatchEnvelopeSchema.parse(raw);
}

/** Whether a fetched match is a stored game: a crawled queue on Summoner's Rift. */
export function isCrawlableMatch(envelope: CrawlMatchEnvelope): boolean {
  const queueIds: readonly number[] = CRAWL_QUEUE_IDS;
  return (
    envelope.info.mapId === CRAWL_MAP_ID &&
    queueIds.includes(envelope.info.queueId)
  );
}

const REDUCED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "ITEM_PURCHASED",
  "ITEM_SOLD",
  "ITEM_DESTROYED",
  "ITEM_UNDO",
  "SKILL_LEVEL_UP",
]);

/** The item and skill fields a reduced event keeps, when Riot states them. */
const EVENT_DETAIL_SCHEMAS = {
  itemId: z.number().int().optional(),
  beforeId: z.number().int().optional(),
  afterId: z.number().int().optional(),
  goldGain: z.number().int().optional(),
  skillSlot: z.number().int().optional(),
  levelUpType: z.string().optional(),
};

const TimelineEventSchema = z.looseObject({
  type: z.string(),
  timestamp: z.number().int(),
  participantId: z.number().int().optional(),
  ...EVENT_DETAIL_SCHEMAS,
});

/**
 * A segment line's reduced timeline, as the lake fold reads it back. The
 * writer below and this reader share one field list, so the two cannot drift.
 */
export const ReducedTimelineSchema = z.object({
  participants: z.array(
    z.object({ participantId: z.number().int(), puuid: LeaguePuuidSchema }),
  ),
  events: z.array(
    z.object({
      t: z.number().int().nonnegative(),
      type: z.string(),
      participantId: z.number().int().nullable(),
      ...EVENT_DETAIL_SCHEMAS,
    }),
  ),
});

const TimelineEnvelopeSchema = z.object({
  info: z.object({
    participants: z
      .array(
        z.object({ participantId: z.number().int(), puuid: LeaguePuuidSchema }),
      )
      .optional(),
    frames: z.array(z.object({ events: z.array(z.unknown()) })),
  }),
});

export type ReducedEvent = {
  t: number;
  type: string;
  participantId: number | null;
  itemId?: number;
  beforeId?: number;
  afterId?: number;
  goldGain?: number;
  skillSlot?: number;
  levelUpType?: string;
};

export type ReducedTimeline = {
  participants: { participantId: number; puuid: LeaguePuuid }[];
  events: ReducedEvent[];
};

const OPTIONAL_EVENT_FIELDS = [
  "itemId",
  "beforeId",
  "afterId",
  "goldGain",
  "skillSlot",
  "levelUpType",
] as const;

function reducedEvent(raw: unknown): ReducedEvent | undefined {
  const typed = z.looseObject({ type: z.string() }).parse(raw);
  if (!REDUCED_EVENT_TYPES.has(typed.type)) return undefined;
  const event = TimelineEventSchema.parse(raw);
  const reduced: ReducedEvent = {
    t: event.timestamp,
    type: event.type,
    participantId: event.participantId ?? null,
  };
  const optional = Object.fromEntries(
    OPTIONAL_EVENT_FIELDS.flatMap((field) =>
      event[field] === undefined ? [] : [[field, event[field]]],
    ),
  );
  return { ...reduced, ...optional };
}

/**
 * Reduce a Match-V5 timeline to item and skill events, in time order, with the
 * participant-id to PUUID mapping needed to attribute them. Frames, positions,
 * kills and objectives are dropped: the crawl stores only what champion build
 * aggregates read.
 */
export function reduceTimeline(raw: unknown): ReducedTimeline {
  const timeline = TimelineEnvelopeSchema.parse(raw);
  const events = timeline.info.frames
    .flatMap((frame) => frame.events)
    .flatMap((rawEvent) => {
      const event = reducedEvent(rawEvent);
      return event === undefined ? [] : [event];
    })
    .toSorted((left, right) => left.t - right.t);
  return { participants: timeline.info.participants ?? [], events };
}

/** One NDJSON line of a crawl segment (schema version 1). */
export type CrawlRecord = {
  v: 1;
  matchId: RiotMatchId;
  platform: string;
  crawledAt: string;
  depth: number;
  /** The visited player this match was found through, with their rank bracket. */
  visited: {
    puuid: LeaguePuuid;
    tier: string | null;
    division: string | null;
  };
  match: unknown;
  timeline: ReducedTimeline | null;
};
