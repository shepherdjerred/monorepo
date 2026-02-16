/**
 * Sound Pack Schema
 *
 * Defines the structure for sound packs used in the Scout for LoL desktop app.
 * Sound packs contain default sounds for events and rules for contextual sound selection.
 */

import { z } from "zod";

// =============================================================================
// Sound Source & Entry
// =============================================================================

/**
 * A sound can come from a local file or a URL (e.g., YouTube)
 */
export const SoundSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file"),
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal("url"),
    // Use string instead of url() to allow YouTube URLs and other formats
    // that may not pass strict URL validation
    url: z.string().min(1),
  }),
]);

export type SoundSource = z.infer<typeof SoundSourceSchema>;

/**
 * A single sound entry with volume and metadata
 */
export const SoundEntrySchema = z.object({
  /** Unique identifier for this sound */
  id: z.string().min(1),
  /** The source of the sound (file or URL) */
  source: SoundSourceSchema,
  /** Volume level (0.0 = silent, 1.0 = 100%, 2.0 = 200%) */
  volume: z.number().min(0).max(2).default(1),
  /** Weight for weighted random selection (higher = more likely) */
  weight: z.number().min(0).nullish(), // nullish accepts null, undefined, or number
  /** Whether this sound is enabled */
  enabled: z.boolean().default(true),
});

export type SoundEntry = z.infer<typeof SoundEntrySchema>;

// =============================================================================
// Sound Pool
// =============================================================================

/**
 * How to select from multiple sounds
 */
export const SelectionModeSchema = z.enum(["random", "sequential", "weighted"]);

export type SelectionMode = z.infer<typeof SelectionModeSchema>;

/**
 * A pool of sounds with selection behavior
 */
export const SoundPoolSchema = z.object({
  /** List of sounds in this pool */
  sounds: z.array(SoundEntrySchema).default([]),
  /** How to select which sound to play */
  selectionMode: SelectionModeSchema.default("random"),
});

export type SoundPool = z.infer<typeof SoundPoolSchema>;

// =============================================================================
// Rule Conditions
// =============================================================================

/**
 * Condition based on player name (killer or victim)
 */
export const PlayerConditionSchema = z.object({
  type: z.literal("player"),
  /** Which player field to check */
  field: z.enum(["killer", "victim"]),
  /** List of summoner names to match */
  players: z.array(z.string()),
  /** Also match the local player (auto-detected) */
  includeLocalPlayer: z.boolean().optional(),
});

export type PlayerCondition = z.infer<typeof PlayerConditionSchema>;

/**
 * Condition based on champion name
 */
export const ChampionConditionSchema = z.object({
  type: z.literal("champion"),
  /** Which player's champion to check */
  field: z.enum(["killerChampion", "victimChampion"]),
  /** List of champion IDs to match (e.g., "Aatrox", "Ahri") */
  champions: z.array(z.string()),
});

export type ChampionCondition = z.infer<typeof ChampionConditionSchema>;

/**
 * Multi-kill types
 */
export const MultikillTypeSchema = z.enum(["double", "triple", "quadra", "penta"]);

export type MultikillType = z.infer<typeof MultikillTypeSchema>;

/**
 * Condition based on multi-kill type
 */
export const MultikillConditionSchema = z.object({
  type: z.literal("multikill"),
  /** Which multi-kill types to match */
  killTypes: z.array(MultikillTypeSchema),
});

export type MultikillCondition = z.infer<typeof MultikillConditionSchema>;

/**
 * Objective types in the game
 */
export const ObjectiveTypeSchema = z.enum(["tower", "inhibitor", "dragon", "baron", "herald"]);

export type ObjectiveType = z.infer<typeof ObjectiveTypeSchema>;

/**
 * Condition based on objective type
 */
export const ObjectiveConditionSchema = z.object({
  type: z.literal("objective"),
  /** Which objective types to match */
  objectives: z.array(ObjectiveTypeSchema),
});

export type ObjectiveCondition = z.infer<typeof ObjectiveConditionSchema>;

/**
 * Dragon types in the game
 */
export const DragonTypeSchema = z.enum(["infernal", "mountain", "ocean", "cloud", "hextech", "chemtech", "elder"]);

export type DragonType = z.infer<typeof DragonTypeSchema>;

/**
 * Condition based on dragon type
 */
export const DragonTypeConditionSchema = z.object({
  type: z.literal("dragonType"),
  /** Which dragon types to match */
  dragons: z.array(DragonTypeSchema),
});

export type DragonTypeCondition = z.infer<typeof DragonTypeConditionSchema>;

/**
 * Condition based on whether an objective was stolen
 */
export const StolenConditionSchema = z.object({
  type: z.literal("stolen"),
  /** Whether the objective was stolen */
  isStolen: z.boolean(),
});

export type StolenCondition = z.infer<typeof StolenConditionSchema>;

/**
 * Condition based on team (ally or enemy relative to local player)
 */
export const TeamConditionSchema = z.object({
  type: z.literal("team"),
  /** Which team to match */
  team: z.enum(["ally", "enemy"]),
});

export type TeamCondition = z.infer<typeof TeamConditionSchema>;

/**
 * Condition based on game result
 */
export const GameResultConditionSchema = z.object({
  type: z.literal("gameResult"),
  /** The game result to match */
  result: z.enum(["victory", "defeat"]),
});

export type GameResultCondition = z.infer<typeof GameResultConditionSchema>;

/**
 * Union of all possible rule conditions
 */
export const RuleConditionSchema = z.discriminatedUnion("type", [
  PlayerConditionSchema,
  ChampionConditionSchema,
  MultikillConditionSchema,
  ObjectiveConditionSchema,
  DragonTypeConditionSchema,
  StolenConditionSchema,
  TeamConditionSchema,
  GameResultConditionSchema,
]);

export type RuleCondition = z.infer<typeof RuleConditionSchema>;

// =============================================================================
// Sound Rules
// =============================================================================

/**
 * A sound rule defines when to play specific sounds based on conditions
 */
export const SoundRuleSchema = z.object({
  /** Unique identifier for this rule */
  id: z.string().min(1),
  /** Human-readable name for the rule */
  name: z.string().min(1),
  /** Whether the rule is active */
  enabled: z.boolean().default(true),
  /** Priority (higher = evaluated first, 0-1000) */
  priority: z.number().int().min(0).max(1000).default(50),
  /** Conditions that must be met */
  conditions: z.array(RuleConditionSchema),
  /** How conditions are combined ("all" = AND, "any" = OR) */
  conditionLogic: z.enum(["all", "any"]).default("all"),
  /** Sounds to play when conditions are met */
  sounds: SoundPoolSchema,
});

export type SoundRule = z.infer<typeof SoundRuleSchema>;

// =============================================================================
// Event Types
// =============================================================================

/**
 * Event types that can trigger sounds
 */
export const EventTypeSchema = z.enum(["gameStart", "gameEnd", "firstBlood", "kill", "multiKill", "objective", "ace"]);

export type EventType = z.infer<typeof EventTypeSchema>;

/**
 * All event types as a constant array
 */
export const EVENT_TYPES: EventType[] = ["gameStart", "gameEnd", "firstBlood", "kill", "multiKill", "objective", "ace"];

/**
 * Human-readable labels for event types
 */
export const EVENT_TYPE_LABELS: Record<EventType, { label: string; description: string }> = {
  gameStart: { label: "Game Start", description: "When the game begins" },
  gameEnd: { label: "Game End", description: "Victory or defeat" },
  firstBlood: { label: "First Blood", description: "First kill of the game" },
  kill: { label: "Kill", description: "When a champion is killed" },
  multiKill: { label: "Multi-kill", description: "Double, triple, quadra, penta" },
  objective: { label: "Objective", description: "Dragon, Baron, towers, etc." },
  ace: { label: "Ace", description: "Team wipe" },
};

// =============================================================================
// Sound Pack Settings
// =============================================================================

/**
 * Global settings for a sound pack
 */
export const SoundPackSettingsSchema = z.object({
  /** Master volume multiplier (0.0-2.0) */
  masterVolume: z.number().min(0).max(2).default(1),
  /** Whether to normalize audio levels before applying volume */
  normalization: z.boolean().default(true),
});

export type SoundPackSettings = z.infer<typeof SoundPackSettingsSchema>;

// =============================================================================
// Sound Pack
// =============================================================================

/**
 * Default sounds record type - one sound pool per event type
 */
export const DefaultSoundsSchema = z.object({
  gameStart: SoundPoolSchema.optional(),
  gameEnd: SoundPoolSchema.optional(),
  firstBlood: SoundPoolSchema.optional(),
  kill: SoundPoolSchema.optional(),
  multiKill: SoundPoolSchema.optional(),
  objective: SoundPoolSchema.optional(),
  ace: SoundPoolSchema.optional(),
});

export type DefaultSounds = z.infer<typeof DefaultSoundsSchema>;

/**
 * A complete sound pack with defaults and rules
 */
export const SoundPackSchema = z.object({
  /** Unique identifier for this sound pack */
  id: z.string().min(1),
  /** Display name */
  name: z.string().min(1),
  /** Version string (semver) */
  version: z.string().default("1.0.0"),
  /** Author name (optional) */
  author: z.string().nullish(), // nullish accepts null, undefined, or string
  /** Description of the sound pack */
  description: z.string().nullish(), // nullish accepts null, undefined, or string

  /** Global settings */
  settings: SoundPackSettingsSchema.default({ masterVolume: 1, normalization: true }),

  /** Default sounds for each event type (fallback when no rules match) */
  defaults: DefaultSoundsSchema.default({}),

  /** Custom rules for contextual sound selection */
  rules: z.array(SoundRuleSchema).default([]),
});

export type SoundPack = z.infer<typeof SoundPackSchema>;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates an empty sound pack with the given ID and name
 */
export function createEmptySoundPack(id: string, name: string): SoundPack {
  return {
    id,
    name,
    version: "1.0.0",
    settings: {
      masterVolume: 1,
      normalization: true,
    },
    defaults: {},
    rules: [],
  };
}

/**
 * Creates an empty sound pool
 */
export function createEmptySoundPool(): SoundPool {
  return {
    sounds: [],
    selectionMode: "random",
  };
}

/**
 * Creates an empty sound rule with the given ID and name
 */
export function createEmptyRule(id: string, name: string): SoundRule {
  return {
    id,
    name,
    enabled: true,
    priority: 50,
    conditions: [],
    conditionLogic: "all",
    sounds: createEmptySoundPool(),
  };
}

/**
 * Generates a unique ID for a new item using a UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}
