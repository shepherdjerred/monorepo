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

/** The timeline events a crawled match keeps; the lake reads nothing else from them. */
export const REDUCED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "ITEM_PURCHASED",
  "ITEM_SOLD",
  "ITEM_DESTROYED",
  "ITEM_UNDO",
  "SKILL_LEVEL_UP",
]);

/**
 * The match times, in milliseconds, whose per-participant gold, experience and
 * creep score the crawl keeps. Public "ahead at 15 minutes" lane rates read
 * them, and they cannot be re-derived later: the raw segment keeps no frames.
 */
export const CHECKPOINT_TIMES_MS = [600_000, 900_000] as const;

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

const CheckpointParticipantSchema = z.object({
  participantId: z.number().int(),
  totalGold: z.number().int(),
  xp: z.number().int(),
  /** `minionsKilled + jungleMinionsKilled`. */
  minions: z.number().int(),
});

const CheckpointSchema = z.object({
  /** The checkpoint time asked for (`CHECKPOINT_TIMES_MS`). */
  atMs: z.number().int().positive(),
  /** The timestamp of the frame read: the latest frame at or before `atMs`. */
  frameMs: z.number().int().nonnegative(),
  participants: z.array(CheckpointParticipantSchema),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;

/**
 * A segment line's reduced timeline, as the lake fold reads it back. The
 * writer below and this reader share one field list, so the two cannot drift.
 *
 * `checkpoints` is absent on lines written before the crawl kept them, and a
 * possibly empty list on every line after: a timeline that ended before every
 * checkpoint states an empty list, so the two are never conflated.
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
  checkpoints: z.array(CheckpointSchema).optional(),
});

const TimelineFrameSchema = z.looseObject({
  timestamp: z.number().int().nonnegative(),
  events: z.array(z.unknown()),
  participantFrames: z.record(
    z.string(),
    z.looseObject({
      participantId: z.number().int(),
      totalGold: z.number().int(),
      xp: z.number().int(),
      minionsKilled: z.number().int(),
      jungleMinionsKilled: z.number().int(),
    }),
  ),
});

type TimelineFrame = z.infer<typeof TimelineFrameSchema>;

const TimelineEnvelopeSchema = z.object({
  info: z.object({
    participants: z
      .array(
        z.object({ participantId: z.number().int(), puuid: LeaguePuuidSchema }),
      )
      .optional(),
    frames: z.array(TimelineFrameSchema),
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
  /** Absent on a line written before the crawl kept checkpoints. */
  checkpoints?: Checkpoint[];
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
 * The participants' economy at `atMs`: the latest frame with a timestamp at or
 * before it, the rule `fetchTimelineFramesAtTime` applies for the logged-in
 * app. A timeline that never reached `atMs` (no frame at or after it) has no
 * checkpoint, so a short game is never given an earlier frame's numbers.
 */
function checkpointAt(
  frames: readonly TimelineFrame[],
  atMs: number,
): Checkpoint | undefined {
  if (!frames.some((frame) => frame.timestamp >= atMs)) return undefined;
  let chosen: TimelineFrame | undefined;
  for (const frame of frames) {
    if (frame.timestamp > atMs) continue;
    if (chosen === undefined || frame.timestamp > chosen.timestamp) {
      chosen = frame;
    }
  }
  if (chosen === undefined) return undefined;
  return {
    atMs,
    frameMs: chosen.timestamp,
    participants: Object.values(chosen.participantFrames)
      .map((frame) => ({
        participantId: frame.participantId,
        totalGold: frame.totalGold,
        xp: frame.xp,
        minions: frame.minionsKilled + frame.jungleMinionsKilled,
      }))
      .toSorted((left, right) => left.participantId - right.participantId),
  };
}

/**
 * Reduce a Match-V5 timeline to item and skill events, in time order, with the
 * participant-id to PUUID mapping needed to attribute them, and the 10- and
 * 15-minute checkpoints. Other frame data, positions, kills and objectives are
 * dropped: the crawl stores only what champion build and lane aggregates read.
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
  const checkpoints = CHECKPOINT_TIMES_MS.flatMap((atMs) => {
    const checkpoint = checkpointAt(timeline.info.frames, atMs);
    return checkpoint === undefined ? [] : [checkpoint];
  });
  return {
    participants: timeline.info.participants ?? [],
    events,
    checkpoints,
  };
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
