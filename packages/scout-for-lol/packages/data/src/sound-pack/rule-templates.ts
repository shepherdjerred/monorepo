/**
 * Preset Rule Templates
 *
 * Common rule configurations that users can use as starting points.
 */

import type { SoundRule } from "./sound-pack.schema.ts";
import { createEmptySoundPool, generateId } from "./sound-pack.schema.ts";

/**
 * A rule template without ID and sounds (user adds their own sounds)
 */
export type RuleTemplate = Omit<SoundRule, "id" | "sounds"> & {
  /** Template identifier */
  templateId: string;
  /** Category for organizing templates */
  category: "multikill" | "objective" | "player" | "game";
};

/**
 * All available rule templates
 */
export const RULE_TEMPLATES: RuleTemplate[] = [
  // Multikill templates
  {
    templateId: "pentakill",
    category: "multikill",
    name: "Pentakill",
    enabled: true,
    priority: 100,
    conditions: [{ type: "multikill", killTypes: ["penta"] }],
    conditionLogic: "all",
  },
  {
    templateId: "quadrakill",
    category: "multikill",
    name: "Quadrakill",
    enabled: true,
    priority: 95,
    conditions: [{ type: "multikill", killTypes: ["quadra"] }],
    conditionLogic: "all",
  },
  {
    templateId: "triplekill",
    category: "multikill",
    name: "Triple Kill",
    enabled: true,
    priority: 90,
    conditions: [{ type: "multikill", killTypes: ["triple"] }],
    conditionLogic: "all",
  },

  // Objective templates
  {
    templateId: "baron-stolen",
    category: "objective",
    name: "Baron Stolen",
    enabled: true,
    priority: 100,
    conditions: [
      { type: "objective", objectives: ["baron"] },
      { type: "stolen", isStolen: true },
    ],
    conditionLogic: "all",
  },
  {
    templateId: "dragon-stolen",
    category: "objective",
    name: "Dragon Stolen",
    enabled: true,
    priority: 95,
    conditions: [
      { type: "objective", objectives: ["dragon"] },
      { type: "stolen", isStolen: true },
    ],
    conditionLogic: "all",
  },
  {
    templateId: "elder-dragon",
    category: "objective",
    name: "Elder Dragon",
    enabled: true,
    priority: 90,
    conditions: [{ type: "dragonType", dragons: ["elder"] }],
    conditionLogic: "all",
  },
  {
    templateId: "baron-kill",
    category: "objective",
    name: "Baron Kill",
    enabled: true,
    priority: 80,
    conditions: [{ type: "objective", objectives: ["baron"] }],
    conditionLogic: "all",
  },

  // Player templates
  {
    templateId: "i-got-kill",
    category: "player",
    name: "I Got a Kill",
    enabled: true,
    priority: 60,
    conditions: [{ type: "player", field: "killer", players: [], includeLocalPlayer: true }],
    conditionLogic: "all",
  },
  {
    templateId: "i-died",
    category: "player",
    name: "I Died",
    enabled: true,
    priority: 60,
    conditions: [{ type: "player", field: "victim", players: [], includeLocalPlayer: true }],
    conditionLogic: "all",
  },
  {
    templateId: "friend-killed",
    category: "player",
    name: "Friend Got a Kill",
    enabled: true,
    priority: 50,
    conditions: [{ type: "player", field: "killer", players: [] }],
    conditionLogic: "all",
  },
  {
    templateId: "friend-died",
    category: "player",
    name: "Friend Died",
    enabled: true,
    priority: 50,
    conditions: [{ type: "player", field: "victim", players: [] }],
    conditionLogic: "all",
  },

  // Game templates
  {
    templateId: "victory",
    category: "game",
    name: "Victory",
    enabled: true,
    priority: 100,
    conditions: [{ type: "gameResult", result: "victory" }],
    conditionLogic: "all",
  },
  {
    templateId: "defeat",
    category: "game",
    name: "Defeat",
    enabled: true,
    priority: 100,
    conditions: [{ type: "gameResult", result: "defeat" }],
    conditionLogic: "all",
  },
];

/**
 * Get templates by category
 */
export function getTemplatesByCategory(category: RuleTemplate["category"]): RuleTemplate[] {
  return RULE_TEMPLATES.filter((t) => t.category === category);
}

/**
 * Get a template by its ID
 */
export function getTemplateById(templateId: string): RuleTemplate | undefined {
  return RULE_TEMPLATES.find((t) => t.templateId === templateId);
}

/**
 * Create a rule from a template
 */
export function createRuleFromTemplate(template: RuleTemplate): SoundRule {
  return {
    id: generateId(),
    name: template.name,
    enabled: template.enabled,
    priority: template.priority,
    conditions: structuredClone(template.conditions),
    conditionLogic: template.conditionLogic,
    sounds: createEmptySoundPool(),
  };
}

/**
 * Category labels for UI display
 */
export const TEMPLATE_CATEGORY_LABELS: Record<RuleTemplate["category"], string> = {
  multikill: "Multi-kills",
  objective: "Objectives",
  player: "Player Events",
  game: "Game Events",
};
