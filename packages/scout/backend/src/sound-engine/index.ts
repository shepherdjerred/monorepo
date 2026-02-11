/**
 * Sound Engine
 *
 * TypeScript port of the Rust sound pack rule evaluation engine.
 * Evaluates rules and selects sounds based on event context.
 */

import { match } from "ts-pattern";
import { pipe, filter, sortBy } from "remeda";
import type {
  SoundPack,
  SoundRule,
  RuleCondition,
  SoundEntry,
  SoundPool,
  EventType,
  MultikillType,
  ObjectiveType,
  DragonType,
} from "@shepherdjerred/scout-data";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";

const logger = createLogger("sound-engine");

/**
 * Context for evaluating sound rules
 */
export type EventContext = {
  /** The type of event */
  eventType: EventType;
  /** Killer's summoner name */
  killerName?: string | undefined;
  /** Victim's summoner name */
  victimName?: string | undefined;
  /** Killer's champion */
  killerChampion?: string | undefined;
  /** Victim's champion */
  victimChampion?: string | undefined;
  /** Whether the killer is the local player */
  killerIsLocal: boolean;
  /** Whether the victim is the local player */
  victimIsLocal: boolean;
  /** Multi-kill type (if applicable) */
  multikillType?: MultikillType | undefined;
  /** Objective type (if applicable) */
  objectiveType?: ObjectiveType | undefined;
  /** Dragon type (if applicable) */
  dragonType?: DragonType | undefined;
  /** Whether the objective was stolen */
  isStolen: boolean;
  /** Whether the killer/actor is on the ally team */
  isAllyTeam: boolean;
  /** Game result (if applicable) */
  gameResult?: "victory" | "defeat" | undefined;
  /** Local player's summoner name */
  localPlayerName?: string | undefined;
};

/**
 * Result of sound selection
 */
export type SoundSelection = {
  /** The selected sound entry */
  sound: SoundEntry;
  /** Effective volume after master volume applied */
  volume: number;
  /** Name of the rule that matched (if any) */
  ruleName?: string;
};

/**
 * Select a sound for a given event context
 *
 * @param pack - The sound pack to evaluate
 * @param context - The event context
 * @returns The selected sound and volume, or null if no sound matches
 */
export function selectSoundForEvent(pack: SoundPack, context: EventContext): SoundSelection | null {
  // Get enabled rules sorted by priority (highest first)
  const sortedRules = pipe(
    pack.rules,
    filter((rule) => rule.enabled),
    sortBy((rule) => -rule.priority),
  );

  // Try each rule in priority order
  for (const rule of sortedRules) {
    if (ruleMatches(rule, context)) {
      const sound = selectFromPool(rule.sounds);
      if (sound) {
        const volume = sound.volume * pack.settings.masterVolume;
        logger.debug(`Rule '${rule.name}' matched, selected sound '${sound.id}' with volume ${String(volume)}`);
        return {
          sound,
          volume,
          ruleName: rule.name,
        };
      }
    }
  }

  // Fall back to default sounds
  const defaultPool = pack.defaults[context.eventType];
  if (defaultPool) {
    const sound = selectFromPool(defaultPool);
    if (sound) {
      const volume = sound.volume * pack.settings.masterVolume;
      logger.debug(`Using default sound '${sound.id}' for ${context.eventType} with volume ${String(volume)}`);
      return {
        sound,
        volume,
      };
    }
  }

  return null;
}

/**
 * Check if a rule matches the given context
 */
function ruleMatches(rule: SoundRule, context: EventContext): boolean {
  if (rule.conditions.length === 0) {
    return false;
  }

  const conditionResults = rule.conditions.map((c) => conditionMatches(c, context));

  return match(rule.conditionLogic)
    .with("all", () => conditionResults.every(Boolean))
    .with("any", () => conditionResults.some(Boolean))
    .exhaustive();
}

/**
 * Check if a single condition matches the context
 */
function conditionMatches(condition: RuleCondition, context: EventContext): boolean {
  return match(condition)
    .with({ type: "player" }, (c) => {
      const targetName = c.field === "killer" ? context.killerName : context.victimName;
      const isLocal = c.field === "killer" ? context.killerIsLocal : context.victimIsLocal;

      // Check if local player matches
      if (c.includeLocalPlayer && isLocal) {
        return true;
      }

      // Check if name is in the list
      if (!targetName) {
        return false;
      }
      return c.players.some((p) => p.toLowerCase() === targetName.toLowerCase());
    })
    .with({ type: "champion" }, (c) => {
      const targetChampion = c.field === "killerChampion" ? context.killerChampion : context.victimChampion;
      if (!targetChampion) {
        return false;
      }
      return c.champions.some((ch) => ch.toLowerCase() === targetChampion.toLowerCase());
    })
    .with({ type: "multikill" }, (c) => {
      if (!context.multikillType) {
        return false;
      }
      return c.killTypes.includes(context.multikillType);
    })
    .with({ type: "objective" }, (c) => {
      if (!context.objectiveType) {
        return false;
      }
      return c.objectives.includes(context.objectiveType);
    })
    .with({ type: "dragonType" }, (c) => {
      if (!context.dragonType) {
        return false;
      }
      return c.dragons.includes(context.dragonType);
    })
    .with({ type: "stolen" }, (c) => context.isStolen === c.isStolen)
    .with({ type: "team" }, (c) => {
      return c.team === "ally" ? context.isAllyTeam : !context.isAllyTeam;
    })
    .with({ type: "gameResult" }, (c) => {
      if (!context.gameResult) {
        return false;
      }
      return context.gameResult === c.result;
    })
    .exhaustive();
}

/**
 * Select a sound from a pool based on selection mode
 */
function selectFromPool(pool: SoundPool): SoundEntry | null {
  const enabledSounds = pool.sounds.filter((s) => s.enabled);
  if (enabledSounds.length === 0) {
    return null;
  }

  return match(pool.selectionMode)
    .with("random", () => {
      const idx = Math.floor(Math.random() * enabledSounds.length);
      return enabledSounds[idx] ?? null;
    })
    .with("sequential", () => {
      // For sequential, we'd need state tracking - just return first for now
      // TODO: Add state tracking for sequential mode
      return enabledSounds[0] ?? null;
    })
    .with("weighted", () => {
      const totalWeight = enabledSounds.reduce((sum, s) => sum + (s.weight ?? 1), 0);
      if (totalWeight <= 0) {
        return enabledSounds[0] ?? null;
      }

      let target = Math.random() * totalWeight;
      for (const sound of enabledSounds) {
        target -= sound.weight ?? 1;
        if (target <= 0) {
          return sound;
        }
      }
      return enabledSounds[enabledSounds.length - 1] ?? null;
    })
    .exhaustive();
}
