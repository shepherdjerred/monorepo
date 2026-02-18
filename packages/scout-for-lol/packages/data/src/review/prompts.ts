/**
 * Prompt schemas and types for AI review generation
 *
 * Note: This module exports schemas and types only.
 * Actual file loading is handled by consuming packages (backend, review-dev-tool)
 * since the data package should remain platform-agnostic.
 */

import { z } from "zod";
import type { Lane } from "@scout-for-lol/data/model/lane";

/**
 * Random behavior schema - weighted random prompts
 */
export const RandomBehaviorSchema = z.strictObject({
  prompt: z.string(),
  weight: z.number().min(0).max(100), // Percentage chance (0-100)
});

export type RandomBehavior = z.infer<typeof RandomBehaviorSchema>;

/**
 * Personality metadata schema
 */
export const PersonalityMetadataSchema = z.strictObject({
  name: z.string(),
  randomBehaviors: z.array(RandomBehaviorSchema).optional(),
  image: z.array(z.string()).optional(),
});

export type PersonalityMetadata = z.infer<typeof PersonalityMetadataSchema>;

/**
 * Personality type (metadata + instructions)
 */
export type Personality = {
  metadata: PersonalityMetadata;
  instructions: string;
  /**
   * Style card loaded from analysis/llm-out to help match voice
   */
  styleCard: string;
  filename?: string;
};

/**
 * Lane context mapping (relative paths from prompts directory)
 */
export const LANE_CONTEXT_MAP: Record<Lane, string> = {
  top: "lanes/top.txt",
  middle: "lanes/middle.txt",
  jungle: "lanes/jungle.txt",
  adc: "lanes/adc.txt",
  support: "lanes/support.txt",
};

/**
 * Files to exclude from personality selection
 */
export const EXCLUDED_PERSONALITY_FILES = new Set(["generic.json"]);

/**
 * Select 3-6 random behaviors from a list using weighted sampling without replacement.
 * Higher-weight behaviors are more likely to be selected.
 *
 * @param behaviors - Array of behaviors with prompts and weights
 * @returns The selected behaviors' prompts joined by newlines, or empty string if none available
 */
export function selectRandomBehaviors(
  behaviors: RandomBehavior[] | undefined,
): string {
  if (!behaviors || behaviors.length === 0) {
    return "";
  }

  // Determine how many behaviors to select (3-6, capped by available)
  const minCount = 3;
  const maxCount = 12;
  const targetCount =
    minCount + Math.floor(Math.random() * (maxCount - minCount + 1));
  const count = Math.min(behaviors.length, targetCount);

  // Create a mutable copy for weighted sampling without replacement
  const remaining = [...behaviors];
  const selected: string[] = [];

  for (let i = 0; i < count; i++) {
    // Calculate total weight of remaining behaviors
    const totalWeight = remaining.reduce((sum, b) => sum + b.weight, 0);

    if (totalWeight <= 0) {
      break;
    }

    // Roll based on total remaining weight
    const roll = Math.random() * totalWeight;

    // Find which behavior was selected
    let cumulative = 0;
    let selectedIndex = 0;
    for (const [j, behavior] of remaining.entries()) {
      if (behavior) {
        cumulative += behavior.weight;
        if (roll < cumulative) {
          selectedIndex = j;
          break;
        }
      }
    }

    // Add selected behavior and remove from pool
    const selectedBehavior = remaining[selectedIndex];
    if (selectedBehavior) {
      selected.push(selectedBehavior.prompt);
      remaining.splice(selectedIndex, 1);
    }
  }

  return selected.join("\n");
}

/**
 * Select 2-3 random image prompts from a personality's image array.
 * These prompts are used to influence AI-generated image concepts.
 *
 * @param imagePrompts - Array of image prompt strings from personality metadata
 * @returns Array of 2-3 randomly selected prompts, or empty array if no prompts available
 */
export function selectRandomImagePrompts(
  imagePrompts: string[] | undefined,
): string[] {
  if (!imagePrompts || imagePrompts.length === 0) {
    return [];
  }

  // Determine how many prompts to select (2-3)
  const count = Math.min(imagePrompts.length, Math.random() < 0.5 ? 2 : 3);

  // Shuffle and take the first `count` items
  const shuffled = [...imagePrompts].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Replace template variables in the base prompt
 */
export function replaceTemplateVariables(
  template: string,
  variables: {
    reviewerName: string;
    playerName: string;
    playerChampion: string;
    playerLane: string;
    opponentChampion: string;
    friendsContext: string;
    randomBehavior: string;
    matchAnalysis: string;
    queueContext: string;
    rankContext: string;
  },
): string {
  return template
    .replaceAll("<REVIEWER NAME>", variables.reviewerName)
    .replaceAll("<PLAYER NAME>", variables.playerName)
    .replaceAll("<PLAYER CHAMPION>", variables.playerChampion)
    .replaceAll("<PLAYER LANE>", variables.playerLane)
    .replaceAll("<OPPONENT CHAMPION>", variables.opponentChampion)
    .replaceAll("<FRIENDS CONTEXT>", variables.friendsContext)
    .replaceAll("<RANDOM BEHAVIOR>", variables.randomBehavior)
    .replaceAll("<MATCH ANALYSIS>", variables.matchAnalysis)
    .replaceAll("<QUEUE CONTEXT>", variables.queueContext)
    .replaceAll("<RANK CONTEXT>", variables.rankContext);
}
