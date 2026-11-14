import { z } from "zod";

const IdSchema = z.union([z.string(), z.number()]).transform(String);
const ValueRecordSchema = z.record(z.string(), z.unknown());
const LegacyPlayerSchema = z
  .object({
    puuid: z.string().min(1),
    profileIcon: z.number(),
    summonerId: IdSchema.optional(),
    summonerName: z.string().optional(),
    gameName: z.string().optional(),
    tagLine: z.string().optional(),
  })
  .loose();
const LegacyIdentitySchema = z
  .object({ participantId: z.number(), player: LegacyPlayerSchema })
  .loose();
const LegacyTimelineSchema = z
  .object({ lane: z.string().optional(), role: z.string().optional() })
  .loose();
const LegacyParticipantSchema = z
  .object({
    participantId: z.number(),
    teamId: z.number(),
    championId: z.number(),
    championName: z.string().optional(),
    spell1Id: z.number(),
    spell2Id: z.number(),
    stats: ValueRecordSchema,
    timeline: LegacyTimelineSchema.optional(),
  })
  .loose();
const LegacyBanSchema = z
  .object({ championId: z.number(), pickTurn: z.number() })
  .loose();
const LegacyTeamSchema = z
  .object({
    teamId: z.number(),
    win: z.union([z.boolean(), z.enum(["Win", "Fail"])]),
    bans: z.array(LegacyBanSchema),
    baronKills: z.number(),
    dragonKills: z.number(),
    firstBaron: z.boolean(),
    firstBlood: z.boolean(),
    // The League client spells it `firstDargon`; accept either.
    firstDragon: z.boolean().optional(),
    firstDargon: z.boolean().optional(),
    firstInhibitor: z.boolean(),
    // Not in the League client's match history; derived where it's provable.
    firstRiftHerald: z.boolean().optional(),
    firstTower: z.boolean(),
    /** Voidgrubs. */
    hordeKills: z.number().optional(),
    inhibitorKills: z.number(),
    riftHeraldKills: z.number(),
    towerKills: z.number(),
  })
  .loose();
const LegacyMatchSchema = z
  .object({
    gameCreation: z.number(),
    gameDuration: z.number(),
    gameId: z.number(),
    gameMode: z.string(),
    // Absent from `/lol-match-history/v1/games/{id}`.
    gameName: z.string().optional(),
    gameType: z.string(),
    gameVersion: z.string(),
    mapId: z.number(),
    participantIdentities: z.array(LegacyIdentitySchema),
    participants: z.array(LegacyParticipantSchema),
    platformId: z.string(),
    queueId: z.number(),
    teams: z.array(LegacyTeamSchema),
    tournamentCode: z.string().optional(),
  })
  .loose();

export const SourcePlayerSchema = z
  .object({
    puuid: z.string().optional(),
    /** Stated by the end-of-game block; bots share one UUID, so it matters. */
    botPlayer: z.boolean().optional(),
    teamId: z.number().optional(),
    profileIconId: z.number().optional(),
    level: z.number().optional(),
    championId: z.number().optional(),
    skinName: z.string().optional(),
    riotIdGameName: z.string().optional(),
    riotIdTagLine: z.string().optional(),
    summonerId: IdSchema.optional(),
    summonerName: z.string().optional(),
    stats: ValueRecordSchema,
  })
  .loose();
const EndOfGameTeamSchema = z
  .object({ players: z.array(SourcePlayerSchema) })
  .loose();
const EndOfGameSchema = z
  .object({
    players: z.array(SourcePlayerSchema).optional(),
    teams: z.array(EndOfGameTeamSchema).optional(),
  })
  .loose();
export const ReplaySchema = z
  .object({ stats: z.array(ValueRecordSchema) })
  .loose();
const LocalTimingSchema = z
  .object({
    gameStartTimestamp: z.number().int().positive(),
    gameEndTimestamp: z.number().int().positive(),
  })
  .strict();
export const LocalMatchCompletionSchema = z.object({
  matchHistory: LegacyMatchSchema.pick({ gameDuration: true }),
  endOfGame: EndOfGameSchema,
  timing: LocalTimingSchema,
});

export const LocalMatchBundleSchema = z
  .object({
    matchHistory: LegacyMatchSchema,
    endOfGame: EndOfGameSchema.optional(),
    replay: ReplaySchema.optional(),
    /**
     * `/lol-match-history/v1/game-timelines/{gameId}`, raw. Validated where it
     * is converted (`lcu-timeline.ts`), so a client too old to send it, or a
     * timeline that doesn't convert, never costs the match itself.
     */
    timeline: z.unknown().optional(),
    timing: LocalTimingSchema,
  })
  .strict();

export type ValueRecord = z.infer<typeof ValueRecordSchema>;
export type SourcePlayer = z.infer<typeof SourcePlayerSchema>;
export type LegacyParticipant = z.infer<typeof LegacyParticipantSchema>;
export type LegacyIdentity = z.infer<typeof LegacyIdentitySchema>;
export type Replay = z.infer<typeof ReplaySchema>;
export type LocalMatchBundle = z.infer<typeof LocalMatchBundleSchema>;

/**
 * What one League-client participant states, gathered by a converter from
 * whichever sources it has. `records` are statistic sources in precedence
 * order; the rest are the facts a source states outside its statistics.
 */
export type LcuParticipantFacts = {
  readonly records: readonly ValueRecord[];
  /** `null` when no source numbers the participant (the end-of-game block). */
  readonly participantId: number | null;
  readonly teamId: number;
  readonly championId: number;
  /** The source's champion name, used only when the ID has no known key. */
  readonly championName: string | undefined;
  readonly skinName: string | undefined;
  readonly spell1Id: number;
  readonly spell2Id: number;
  readonly timeline:
    { lane?: string | undefined; role?: string | undefined } | undefined;
  readonly profileIcon: number | undefined;
  readonly riotIdGameName: string | undefined;
  readonly riotIdName: string | undefined;
  /** The statistics source's own tag line, read before any record. */
  readonly riotIdTagLine: string | undefined;
  /** The identity's tag line, read after every record. */
  readonly identityTagLine: string | undefined;
  readonly summonerId: string | undefined;
  readonly summonerLevel: number | undefined;
  readonly summonerName: string | undefined;
};
