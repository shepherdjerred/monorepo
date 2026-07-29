/**
 * Prompt loading and management utilities
 */
import type { Personality } from "./config/schema.ts";
import { PersonalityMetadataSchema } from "./config/schema.ts";
import {
  getStyleCard,
  serializeStyleCardForScoutPrompt,
  type Lane,
} from "@scout-for-lol/data";

// Import personality files
import aaronJson from "@scout-for-lol/data/review/prompts/personalities/aaron.json";
import aaronTxt from "@scout-for-lol/data/review/prompts/personalities/aaron.txt?raw";
import brianJson from "@scout-for-lol/data/review/prompts/personalities/brian.json";
import brianTxt from "@scout-for-lol/data/review/prompts/personalities/brian.txt?raw";
import caitlynJson from "@scout-for-lol/data/review/prompts/personalities/caitlyn.json";
import caitlynTxt from "@scout-for-lol/data/review/prompts/personalities/caitlyn.txt?raw";
import colinJson from "@scout-for-lol/data/review/prompts/personalities/colin.json";
import colinTxt from "@scout-for-lol/data/review/prompts/personalities/colin.txt?raw";
import dannyJson from "@scout-for-lol/data/review/prompts/personalities/danny.json";
import dannyTxt from "@scout-for-lol/data/review/prompts/personalities/danny.txt?raw";
import edwardJson from "@scout-for-lol/data/review/prompts/personalities/edward.json";
import edwardTxt from "@scout-for-lol/data/review/prompts/personalities/edward.txt?raw";
import hirzaJson from "@scout-for-lol/data/review/prompts/personalities/hirza.json";
import hirzaTxt from "@scout-for-lol/data/review/prompts/personalities/hirza.txt?raw";
import irfanJson from "@scout-for-lol/data/review/prompts/personalities/irfan.json";
import irfanTxt from "@scout-for-lol/data/review/prompts/personalities/irfan.txt?raw";
import jerredJson from "@scout-for-lol/data/review/prompts/personalities/jerred.json";
import jerredTxt from "@scout-for-lol/data/review/prompts/personalities/jerred.txt?raw";
import longJson from "@scout-for-lol/data/review/prompts/personalities/long.json";
import longTxt from "@scout-for-lol/data/review/prompts/personalities/long.txt?raw";
import nekoryanJson from "@scout-for-lol/data/review/prompts/personalities/nekoryan.json";
import nekoryanTxt from "@scout-for-lol/data/review/prompts/personalities/nekoryan.txt?raw";
import richardJson from "@scout-for-lol/data/review/prompts/personalities/richard.json";
import richardTxt from "@scout-for-lol/data/review/prompts/personalities/richard.txt?raw";
import virmelJson from "@scout-for-lol/data/review/prompts/personalities/virmel.json";
import virmelTxt from "@scout-for-lol/data/review/prompts/personalities/virmel.txt?raw";

// Import lane contexts
import topLane from "@scout-for-lol/data/review/prompts/lanes/top.txt?raw";
import middleLane from "@scout-for-lol/data/review/prompts/lanes/middle.txt?raw";
import jungleLane from "@scout-for-lol/data/review/prompts/lanes/jungle.txt?raw";
import adcLane from "@scout-for-lol/data/review/prompts/lanes/adc.txt?raw";
import supportLane from "@scout-for-lol/data/review/prompts/lanes/support.txt?raw";
import genericLane from "@scout-for-lol/data/review/prompts/lanes/generic.txt?raw";

// Import base prompt template (user prompt for review text stage)
import basePrompt from "@scout-for-lol/data/review/prompts/user/2-review-text.txt?raw";

function requiredStyleCard(personalityId: string): string {
  const styleCard = getStyleCard(personalityId);
  if (styleCard === undefined) {
    throw new Error(
      `Missing required shared style card for personality "${personalityId}"`,
    );
  }
  return serializeStyleCardForScoutPrompt(styleCard);
}

/**
 * Built-in personalities (from prompt files)
 */
const RAW_BUILTIN_PERSONALITIES: Personality[] = [
  {
    id: "aaron",
    metadata: PersonalityMetadataSchema.parse(aaronJson),
    instructions: aaronTxt,
    styleCard: requiredStyleCard("aaron"),
  },
  {
    id: "brian",
    metadata: PersonalityMetadataSchema.parse(brianJson),
    instructions: brianTxt,
    styleCard: requiredStyleCard("brian"),
  },
  {
    id: "caitlyn",
    metadata: PersonalityMetadataSchema.parse(caitlynJson),
    instructions: caitlynTxt,
    styleCard: requiredStyleCard("caitlyn"),
  },
  {
    id: "colin",
    metadata: PersonalityMetadataSchema.parse(colinJson),
    instructions: colinTxt,
    styleCard: requiredStyleCard("colin"),
  },
  {
    id: "danny",
    metadata: PersonalityMetadataSchema.parse(dannyJson),
    instructions: dannyTxt,
    styleCard: requiredStyleCard("danny"),
  },
  {
    id: "edward",
    metadata: PersonalityMetadataSchema.parse(edwardJson),
    instructions: edwardTxt,
    styleCard: requiredStyleCard("edward"),
  },
  {
    id: "hirza",
    metadata: PersonalityMetadataSchema.parse(hirzaJson),
    instructions: hirzaTxt,
    styleCard: requiredStyleCard("hirza"),
  },
  {
    id: "irfan",
    metadata: PersonalityMetadataSchema.parse(irfanJson),
    instructions: irfanTxt,
    styleCard: requiredStyleCard("irfan"),
  },
  {
    id: "jerred",
    metadata: PersonalityMetadataSchema.parse(jerredJson),
    instructions: jerredTxt,
    styleCard: requiredStyleCard("jerred"),
  },
  {
    id: "long",
    metadata: PersonalityMetadataSchema.parse(longJson),
    instructions: longTxt,
    styleCard: requiredStyleCard("long"),
  },
  {
    id: "nekoryan",
    metadata: PersonalityMetadataSchema.parse(nekoryanJson),
    instructions: nekoryanTxt,
    styleCard: requiredStyleCard("nekoryan"),
  },
  {
    id: "richard",
    metadata: PersonalityMetadataSchema.parse(richardJson),
    instructions: richardTxt,
    styleCard: requiredStyleCard("richard"),
  },
  {
    id: "virmel",
    metadata: PersonalityMetadataSchema.parse(virmelJson),
    instructions: virmelTxt,
    styleCard: requiredStyleCard("virmel"),
  },
];

const discardedPersonalities: string[] = [];
const BUILTIN_PERSONALITIES_INTERNAL: Personality[] =
  RAW_BUILTIN_PERSONALITIES.filter((p) => {
    if (p.styleCard.trim().length === 0) {
      discardedPersonalities.push(p.id);
      return false;
    }
    return true;
  });

if (discardedPersonalities.length > 0) {
  console.warn(
    `[review-tool] Discarded personalities missing style cards: ${discardedPersonalities.join(", ")}`,
  );
}

export const BUILTIN_PERSONALITIES = BUILTIN_PERSONALITIES_INTERNAL;

/**
 * Lane context mapping
 */
const LANE_CONTEXTS: Record<Lane, string> = {
  top: topLane,
  middle: middleLane,
  jungle: jungleLane,
  adc: adcLane,
  support: supportLane,
};

/**
 * Get base prompt template
 */
export function getBasePrompt(): string {
  return basePrompt;
}

/**
 * Select a random personality from built-in personalities
 */
export function selectRandomPersonality(): Personality {
  // Exclude generic from random selection
  const selectablePersonalities = BUILTIN_PERSONALITIES_INTERNAL.filter(
    (p) => p.id !== "generic",
  );
  const randomIndex = Math.floor(
    Math.random() * selectablePersonalities.length,
  );
  const selected = selectablePersonalities[randomIndex];
  if (!selected) {
    throw new Error("Failed to select personality");
  }
  return selected;
}

/**
 * Get personality by ID (checks built-in personalities only)
 * For custom personalities, use the personality storage functions directly
 */
export function getPersonalityById(id: string): Personality | undefined {
  return BUILTIN_PERSONALITIES_INTERNAL.find((p) => p.id === id);
}

/**
 * Get lane context
 */
export function getLaneContext(lane: string | undefined): string {
  if (lane === undefined) {
    return genericLane;
  }

  const lowerLane = lane.toLowerCase();
  // Check if lane is a valid key
  const validLanes: Record<string, string> = LANE_CONTEXTS;
  if (lowerLane in validLanes) {
    const laneValue = validLanes[lowerLane];
    if (laneValue !== undefined && laneValue.length > 0) {
      return laneValue;
    }
  }

  return genericLane;
}
