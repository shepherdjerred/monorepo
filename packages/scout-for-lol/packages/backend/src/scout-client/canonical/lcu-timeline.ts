import {
  RawTimelineSchema,
  type RawTimeline,
  type RawTimelineEvent,
} from "@scout-for-lol/data";
import { z } from "zod";

/** Match-V5 frames a timeline once a minute; so does the League client. */
const FRAME_INTERVAL_MS = 60_000;
/** How far the client's second frame may sit from a whole minute. */
const FRAME_INTERVAL_TOLERANCE_MS = 5000;
/** A Riot API PUUID: the only identity a converted timeline may carry. */
const RIOT_PUUID_LENGTH = 78;

const PositionSchema = z.object({ x: z.number(), y: z.number() });

const LcuParticipantFrameSchema = z
  .object({
    currentGold: z.number(),
    jungleMinionsKilled: z.number(),
    level: z.number(),
    minionsKilled: z.number(),
    participantId: z.number(),
    position: PositionSchema,
    totalGold: z.number(),
    xp: z.number(),
  })
  .loose();

const LcuEventSchema = z
  .object({
    type: z.string().min(1),
    timestamp: z.number(),
    killerId: z.number().optional(),
    victimId: z.number().optional(),
    participantId: z.number().optional(),
    teamId: z.number().optional(),
    assistingParticipantIds: z.array(z.number()).optional(),
    position: PositionSchema.optional(),
    buildingType: z.string().optional(),
    laneType: z.string().optional(),
    towerType: z.string().optional(),
    monsterType: z.string().optional(),
    monsterSubType: z.string().optional(),
  })
  .loose();

const LcuFrameSchema = z.object({
  timestamp: z.number(),
  participantFrames: z.record(z.string(), LcuParticipantFrameSchema),
  events: z.array(LcuEventSchema),
});

/** `/lol-match-history/v1/game-timelines/{gameId}`. */
export const LcuTimelineSchema = z
  .object({ frames: z.array(LcuFrameSchema).min(1) })
  .loose();

/** The roster half of `/lol-match-history/v1/games/{gameId}`. */
const LcuGameRosterSchema = z
  .object({
    gameId: z.number(),
    endOfGameResult: z.string().optional(),
    participantIdentities: z.array(
      z.object({
        participantId: z.number(),
        player: z.object({ puuid: z.string() }).loose(),
      }),
    ),
    participants: z.array(
      z.object({ participantId: z.number(), teamId: z.number() }).loose(),
    ),
  })
  .loose();

type LcuEvent = z.infer<typeof LcuEventSchema>;

/** A text field the League client fills with "" when it doesn't apply. */
function stated(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/**
 * One event in Match-V5's vocabulary.
 *
 * The League client stamps every event with every field, zeroed where it
 * doesn't apply — a kill carries `buildingType: ""` and `itemId: 0`. Each type
 * keeps only what Match-V5 gives it, so a zero placeholder never reads as a
 * real item, monster or building. `killerTeamId` on an objective is the
 * killer's side from the roster; nothing is invented.
 */
function convertEvent(
  event: LcuEvent,
  teamOf: ReadonlyMap<number, number>,
): RawTimelineEvent {
  const base = { type: event.type, timestamp: event.timestamp };
  const assists = event.assistingParticipantIds ?? [];
  switch (event.type) {
    case "CHAMPION_KILL": {
      return {
        ...base,
        killerId: event.killerId,
        victimId: event.victimId,
        assistingParticipantIds: assists,
        position: event.position,
      };
    }
    case "BUILDING_KILL": {
      return {
        ...base,
        killerId: event.killerId,
        assistingParticipantIds: assists,
        buildingType: stated(event.buildingType),
        laneType: stated(event.laneType),
        towerType: stated(event.towerType),
        teamId: event.teamId,
        position: event.position,
      };
    }
    case "ELITE_MONSTER_KILL": {
      return {
        ...base,
        killerId: event.killerId,
        killerTeamId:
          event.killerId === undefined ? undefined : teamOf.get(event.killerId),
        assistingParticipantIds: assists,
        monsterType: stated(event.monsterType),
        monsterSubType: stated(event.monsterSubType),
        position: event.position,
      };
    }
    default: {
      // A type this converter has not been taught keeps only what every event
      // states. Guessing which zeroed fields mattered could invent facts.
      return base;
    }
  }
}

/**
 * A Match-V5 timeline from the League client's own match history.
 *
 * `game` and `timeline` are the raw LCU payloads for one game, with player
 * identities already translated to Riot PUUIDs. The result is tagged
 * `local-1`, and carries every per-minute fact the League client reports for
 * every participant: gold, experience, level, minion and jungle CS, and map
 * position, plus kills, buildings, and elite monsters. Match-V5 fields the
 * League client never reports stay absent — item, skill and ward events,
 * per-frame champion and damage stats, gold per second, and crowd-control
 * time — rather than appearing as zeroes.
 *
 * Returns `null` for anything that cannot be converted faithfully: an
 * identity still in League-client form, a roster that doesn't match the
 * frames, or frames that aren't a minute apart.
 */
export function convertLcuTimeline(
  riotMatchId: string,
  gamePayload: unknown,
  timelinePayload: unknown,
): RawTimeline | null {
  const game = LcuGameRosterSchema.safeParse(gamePayload);
  const timeline = LcuTimelineSchema.safeParse(timelinePayload);
  if (!game.success || !timeline.success) return null;
  const identities = [...game.data.participantIdentities].sort(
    (left, right) => left.participantId - right.participantId,
  );
  if (
    identities.length === 0 ||
    identities.some(
      (identity) => identity.player.puuid.length !== RIOT_PUUID_LENGTH,
    )
  ) {
    return null;
  }
  const participantIds = new Set(
    identities.map((identity) => identity.participantId),
  );
  const frames = timeline.data.frames;
  const second = frames[1];
  if (
    second !== undefined &&
    Math.abs(second.timestamp - FRAME_INTERVAL_MS) > FRAME_INTERVAL_TOLERANCE_MS
  ) {
    return null;
  }
  if (
    frames.some((frame) =>
      Object.values(frame.participantFrames).some(
        (participantFrame) =>
          !participantIds.has(participantFrame.participantId),
      ),
    )
  ) {
    return null;
  }
  const teamOf = new Map(
    game.data.participants.map((participant) => [
      participant.participantId,
      participant.teamId,
    ]),
  );
  const converted = RawTimelineSchema.safeParse({
    metadata: {
      dataVersion: "local-1",
      matchId: riotMatchId,
      participants: identities.map((identity) => identity.player.puuid),
    },
    info: {
      ...(game.data.endOfGameResult === undefined
        ? {}
        : { endOfGameResult: game.data.endOfGameResult }),
      frameInterval: FRAME_INTERVAL_MS,
      gameId: game.data.gameId,
      participants: identities.map((identity) => ({
        participantId: identity.participantId,
        puuid: identity.player.puuid,
      })),
      frames: frames.map((frame) => ({
        timestamp: frame.timestamp,
        participantFrames: Object.fromEntries(
          Object.entries(frame.participantFrames).map(([key, value]) => [
            key,
            {
              currentGold: value.currentGold,
              jungleMinionsKilled: value.jungleMinionsKilled,
              level: value.level,
              minionsKilled: value.minionsKilled,
              participantId: value.participantId,
              position: value.position,
              totalGold: value.totalGold,
              xp: value.xp,
            },
          ]),
        ),
        events: frame.events.map((event) => convertEvent(event, teamOf)),
      })),
    },
  });
  return converted.success ? converted.data : null;
}
