/**
 * Prompt Variable Metadata
 *
 * Single source of truth for all prompt template variables.
 * This ensures frontend and backend stay in sync.
 *
 * When adding a new variable to a prompt:
 * 1. Add it to the appropriate stage's variables here
 * 2. Use it in the prompt template
 * 3. Ensure it's replaced in pipeline-stages.ts
 *
 * The frontend automatically displays these variables in the UI.
 */

/**
 * Variable information for documentation
 */
export type PromptVariable = {
  /** Variable name as it appears in the template (without angle brackets) */
  name: string;
  /** Human-readable description of what this variable contains */
  description: string;
};

/**
 * Variables for a single stage
 */
export type StagePromptVariables = {
  /** Variables available in the system prompt */
  system: readonly PromptVariable[];
  /** Variables available in the user prompt */
  user: readonly PromptVariable[];
};

/**
 * All stage names that have configurable prompts
 */
export const PROMPT_STAGE_NAMES = [
  "timelineSummary",
  "matchSummary",
  "reviewText",
  "imageDescription",
  "imageGeneration",
] as const;

export type PromptStageName = (typeof PROMPT_STAGE_NAMES)[number];

/**
 * Variable definitions for each pipeline stage
 *
 * IMPORTANT: Keep this in sync with:
 * - Prompt templates in prompts/user/*.txt and prompts/system/*.txt
 * - Variable replacement in pipeline-stages.ts
 */
export const STAGE_PROMPT_VARIABLES = {
  timelineSummary: {
    system: [
      {
        name: "LANE_CONTEXT",
        description:
          "Lane-specific context (e.g., top lane plays, jungle pathing)",
      },
    ],
    user: [
      {
        name: "TIMELINE_DATA",
        description:
          "Minified JSON of enriched timeline with participant lookups",
      },
    ],
  },

  matchSummary: {
    system: [],
    user: [
      { name: "PLAYER_NAME", description: "Player alias" },
      { name: "PLAYER_CHAMPION", description: "Champion name" },
      { name: "PLAYER_LANE", description: "Lane (or 'arena' for arena queue)" },
      {
        name: "MATCH_DATA",
        description:
          "Minified JSON containing both processedMatch and rawMatch",
      },
    ],
  },

  reviewText: {
    system: [
      {
        name: "PERSONALITY_INSTRUCTIONS",
        description: "Personality instructions text (how the reviewer talks)",
      },
      {
        name: "STYLE_CARD",
        description: "Minified JSON style card (AI analysis of writing style)",
      },
    ],
    user: [
      {
        name: "REVIEWER NAME",
        description: "Personality name (e.g., 'Aaron')",
      },
      { name: "PLAYER NAME", description: "Player being reviewed" },
      { name: "PLAYER CHAMPION", description: "Their champion" },
      { name: "PLAYER LANE", description: "Their lane" },
      { name: "OPPONENT CHAMPION", description: "Enemy laner's champion" },
      {
        name: "FRIENDS CONTEXT",
        description: "Info about other tracked players in match",
      },
      {
        name: "RANDOM BEHAVIOR",
        description:
          "Random personality-specific behavior (from randomBehaviors)",
      },
      {
        name: "MATCH ANALYSIS",
        description: "Text output from Stage 1b (match summary)",
      },
      {
        name: "QUEUE CONTEXT",
        description: "Queue type and context (solo, flex, clash, etc.)",
      },
      {
        name: "RANK CONTEXT",
        description: "Rank changes (promos, demotions, LP gains)",
      },
    ],
  },

  imageDescription: {
    system: [],
    user: [
      {
        name: "REVIEW_TEXT",
        description: "Output from Stage 2 (the generated review)",
      },
      { name: "ART_STYLE", description: "Selected art style description" },
    ],
  },

  imageGeneration: {
    system: [],
    user: [
      {
        name: "IMAGE_DESCRIPTION",
        description: "Output from Stage 3 (the image description)",
      },
      { name: "ART_STYLE", description: "Selected art style description" },
    ],
  },
} as const satisfies Record<PromptStageName, StagePromptVariables>;

/**
 * Type for the stage variables map - ensures type safety when accessing
 */
export type StagePromptVariablesMap = typeof STAGE_PROMPT_VARIABLES;

/**
 * Get variables for a specific stage
 *
 * This is type-safe and will error if an invalid stage name is used.
 */
export function getStageVariables(
  stage: PromptStageName,
): StagePromptVariables {
  return STAGE_PROMPT_VARIABLES[stage];
}
