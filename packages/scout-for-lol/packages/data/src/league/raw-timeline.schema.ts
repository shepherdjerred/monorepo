import { z } from "zod";

/**
 * Zod schema for Match V5 Timeline API response from Riot Games
 *
 * The timeline contains frame-by-frame game data including:
 * - Participant stats evolution (gold, XP, position)
 * - Game events (kills, item purchases, objectives, etc.)
 */

/**
 * Raw Timeline Position - X/Y coordinates on the map
 */
export const RawTimelinePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

/**
 * Champion stats at a specific frame - subset of relevant stats
 */
export const RawTimelineChampionStatsSchema = z
  .object({
    abilityHaste: z.number().optional(),
    abilityPower: z.number().optional(),
    armor: z.number().optional(),
    armorPen: z.number().optional(),
    armorPenPercent: z.number().optional(),
    attackDamage: z.number().optional(),
    attackSpeed: z.number().optional(),
    bonusArmorPenPercent: z.number().optional(),
    bonusMagicPenPercent: z.number().optional(),
    ccReduction: z.number().optional(),
    cooldownReduction: z.number().optional(),
    health: z.number().optional(),
    healthMax: z.number().optional(),
    healthRegen: z.number().optional(),
    lifesteal: z.number().optional(),
    magicPen: z.number().optional(),
    magicPenPercent: z.number().optional(),
    magicResist: z.number().optional(),
    movementSpeed: z.number().optional(),
    omnivamp: z.number().optional(),
    physicalVamp: z.number().optional(),
    power: z.number().optional(),
    powerMax: z.number().optional(),
    powerRegen: z.number().optional(),
    spellVamp: z.number().optional(),
  })
  .loose();

/**
 * Damage stats for a participant at a specific frame
 */
export const RawTimelineDamageStatsSchema = z
  .object({
    magicDamageDone: z.number().optional(),
    magicDamageDoneToChampions: z.number().optional(),
    magicDamageTaken: z.number().optional(),
    physicalDamageDone: z.number().optional(),
    physicalDamageDoneToChampions: z.number().optional(),
    physicalDamageTaken: z.number().optional(),
    totalDamageDone: z.number().optional(),
    totalDamageDoneToChampions: z.number().optional(),
    totalDamageTaken: z.number().optional(),
    trueDamageDone: z.number().optional(),
    trueDamageDoneToChampions: z.number().optional(),
    trueDamageTaken: z.number().optional(),
  })
  .loose();

/**
 * Raw Timeline Participant Frame - state of a participant at a specific frame
 */
export const RawTimelineParticipantFrameSchema = z
  .object({
    championStats: RawTimelineChampionStatsSchema.optional(),
    currentGold: z.number(),
    damageStats: RawTimelineDamageStatsSchema.optional(),
    goldPerSecond: z.number(),
    jungleMinionsKilled: z.number(),
    level: z.number(),
    minionsKilled: z.number(),
    participantId: z.number(),
    position: RawTimelinePositionSchema,
    timeEnemySpentControlled: z.number(),
    totalGold: z.number(),
    xp: z.number(),
  })
  .loose();

/**
 * Victim damage entry for kill events
 */
export const RawTimelineVictimDamageSchema = z
  .object({
    basic: z.boolean(),
    magicDamage: z.number(),
    name: z.string(),
    participantId: z.number(),
    physicalDamage: z.number(),
    spellName: z.string(),
    spellSlot: z.number(),
    trueDamage: z.number(),
    type: z.string(),
  })
  .loose();

/**
 * Raw Timeline Event - represents an event that occurred during the match
 * Events have varying structures depending on their type
 */
export const RawTimelineEventSchema = z
  .object({
    // Common fields
    timestamp: z.number(),
    type: z.string(),

    // Kill event fields
    killerId: z.number().optional(),
    victimId: z.number().optional(),
    assistingParticipantIds: z.array(z.number()).optional(),
    position: RawTimelinePositionSchema.optional(),
    bounty: z.number().optional(),
    killStreakLength: z.number().optional(),
    shutdownBounty: z.number().optional(),
    victimDamageDealt: z.array(RawTimelineVictimDamageSchema).optional(),
    victimDamageReceived: z.array(RawTimelineVictimDamageSchema).optional(),

    // Item event fields
    participantId: z.number().optional(),
    itemId: z.number().optional(),
    afterId: z.number().optional(),
    beforeId: z.number().optional(),

    // Skill event fields
    skillSlot: z.number().optional(),
    levelUpType: z.string().optional(),

    // Ward event fields
    wardType: z.string().optional(),
    creatorId: z.number().optional(),

    // Building event fields
    buildingType: z.string().optional(),
    laneType: z.string().optional(),
    teamId: z.number().optional(),
    towerType: z.string().optional(),

    // Monster event fields
    monsterType: z.string().optional(),
    monsterSubType: z.string().optional(),
    killerTeamId: z.number().optional(),

    // Level up fields
    level: z.number().optional(),

    // Gold transformation fields
    goldGain: z.number().optional(),

    // Real timestamp for specific events
    realTimestamp: z.number().optional(),

    // Game end fields
    gameId: z.number().optional(),
    winningTeam: z.number().optional(),
  })
  .loose();

/**
 * Raw Timeline Frame - game state at a specific timestamp
 * Note: participantFrames can be null for the first frame (timestamp 0) in some matches
 */
export const RawTimelineFrameSchema = z.object({
  events: z.array(RawTimelineEventSchema),
  participantFrames: z.record(z.string(), RawTimelineParticipantFrameSchema).nullable(),
  timestamp: z.number(),
});

/**
 * Timeline participant info
 */
export const RawTimelineParticipantInfoSchema = z
  .object({
    participantId: z.number(),
    puuid: z.string(),
  })
  .loose();

/**
 * Raw Timeline Info - main timeline information
 */
export const RawTimelineInfoSchema = z
  .object({
    endOfGameResult: z.string().optional(),
    frameInterval: z.number(),
    frames: z.array(RawTimelineFrameSchema),
    gameId: z.number(),
    participants: z.array(RawTimelineParticipantInfoSchema),
  })
  .loose();

/**
 * Raw Timeline Metadata
 */
export const RawTimelineMetadataSchema = z.object({
  dataVersion: z.string(),
  matchId: z.string(),
  participants: z.array(z.string()),
});

/**
 * Main RawTimeline schema - represents a match timeline from Riot Games Match V5 API
 */
export const RawTimelineSchema = z.object({
  metadata: RawTimelineMetadataSchema,
  info: RawTimelineInfoSchema,
});

// Export types
export type RawTimeline = z.infer<typeof RawTimelineSchema>;
export type RawTimelineInfo = z.infer<typeof RawTimelineInfoSchema>;
export type RawTimelineMetadata = z.infer<typeof RawTimelineMetadataSchema>;
export type RawTimelineFrame = z.infer<typeof RawTimelineFrameSchema>;
export type RawTimelineEvent = z.infer<typeof RawTimelineEventSchema>;
export type RawTimelineParticipantFrame = z.infer<typeof RawTimelineParticipantFrameSchema>;
export type RawTimelinePosition = z.infer<typeof RawTimelinePositionSchema>;
