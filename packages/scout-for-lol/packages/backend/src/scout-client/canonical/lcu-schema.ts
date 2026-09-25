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
    firstDragon: z.boolean(),
    firstInhibitor: z.boolean(),
    firstRiftHerald: z.boolean(),
    firstTower: z.boolean(),
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
    gameName: z.string(),
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
export const LocalMatchBundleSchema = z
  .object({
    matchHistory: LegacyMatchSchema,
    endOfGame: EndOfGameSchema.optional(),
    replay: ReplaySchema.optional(),
    timing: LocalTimingSchema,
  })
  .strict();

export type ValueRecord = z.infer<typeof ValueRecordSchema>;
export type SourcePlayer = z.infer<typeof SourcePlayerSchema>;
export type LegacyParticipant = z.infer<typeof LegacyParticipantSchema>;
export type LegacyIdentity = z.infer<typeof LegacyIdentitySchema>;
export type Replay = z.infer<typeof ReplaySchema>;
export type LocalMatchBundle = z.infer<typeof LocalMatchBundleSchema>;
