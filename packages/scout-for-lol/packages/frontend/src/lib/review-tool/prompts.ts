/**
 * Prompt loading and management utilities
 */
import type { Personality } from "./config/schema.ts";
import { PersonalityMetadataSchema } from "./config/schema.ts";
import type { Lane } from "@scout-for-lol/data";

// Import personality files
import aaronJson from "@scout-for-lol/data/src/review/prompts/personalities/aaron.json";
import aaronTxt from "@scout-for-lol/data/src/review/prompts/personalities/aaron.txt?raw";
import brianJson from "@scout-for-lol/data/src/review/prompts/personalities/brian.json";
import brianTxt from "@scout-for-lol/data/src/review/prompts/personalities/brian.txt?raw";
import caitlynJson from "@scout-for-lol/data/src/review/prompts/personalities/caitlyn.json";
import caitlynTxt from "@scout-for-lol/data/src/review/prompts/personalities/caitlyn.txt?raw";
import colinJson from "@scout-for-lol/data/src/review/prompts/personalities/colin.json";
import colinTxt from "@scout-for-lol/data/src/review/prompts/personalities/colin.txt?raw";
import dannyJson from "@scout-for-lol/data/src/review/prompts/personalities/danny.json";
import dannyTxt from "@scout-for-lol/data/src/review/prompts/personalities/danny.txt?raw";
import edwardJson from "@scout-for-lol/data/src/review/prompts/personalities/edward.json";
import edwardTxt from "@scout-for-lol/data/src/review/prompts/personalities/edward.txt?raw";
import hirzaJson from "@scout-for-lol/data/src/review/prompts/personalities/hirza.json";
import hirzaTxt from "@scout-for-lol/data/src/review/prompts/personalities/hirza.txt?raw";
import irfanJson from "@scout-for-lol/data/src/review/prompts/personalities/irfan.json";
import irfanTxt from "@scout-for-lol/data/src/review/prompts/personalities/irfan.txt?raw";
import jerredJson from "@scout-for-lol/data/src/review/prompts/personalities/jerred.json";
import jerredTxt from "@scout-for-lol/data/src/review/prompts/personalities/jerred.txt?raw";
import longJson from "@scout-for-lol/data/src/review/prompts/personalities/long.json";
import longTxt from "@scout-for-lol/data/src/review/prompts/personalities/long.txt?raw";
import nekoryanJson from "@scout-for-lol/data/src/review/prompts/personalities/nekoryan.json";
import nekoryanTxt from "@scout-for-lol/data/src/review/prompts/personalities/nekoryan.txt?raw";
import richardJson from "@scout-for-lol/data/src/review/prompts/personalities/richard.json";
import richardTxt from "@scout-for-lol/data/src/review/prompts/personalities/richard.txt?raw";
import virmelJson from "@scout-for-lol/data/src/review/prompts/personalities/virmel.json";
import virmelTxt from "@scout-for-lol/data/src/review/prompts/personalities/virmel.txt?raw";

// Import style cards
import aaronStyleCard from "@scout-for-lol/data/src/review/prompts/style-cards/aaron_style.json";
import brianStyleCard from "@scout-for-lol/data/src/review/prompts/style-cards/brian_style.json";
import caitlynStyleCard from "@scout-for-lol/data/src/review/prompts/style-cards/caitlyn_style.json";
import colinStyleCard from "@scout-for-lol/data/src/review/prompts/style-cards/colin_style.json";
import dannyStyleCard from "@scout-for-lol/data/src/review/prompts/style-cards/danny_style.json";
import edwardStyleCard from "@scout-for-lol/data/src/review/prompts/style-cards/edward_style.json";
import hirzaStyleCard from "@scout-for-lol/data/src/review/prompts/style-cards/hirza_style.json";
import irfanStyleCard from "@scout-for-lol/data/src/review/prompts/style-cards/irfan_style.json";
import jerredStyleCard from "@scout-for-lol/data/src/review/prompts/style-cards/jerred_style.json";
import longStyleCard from "@scout-for-lol/data/src/review/prompts/style-cards/long_style.json";
import nekoryanStyleCard from "@scout-for-lol/data/src/review/prompts/style-cards/nekoryan_style.json";
import richardStyleCard from "@scout-for-lol/data/src/review/prompts/style-cards/richard_style.json";
import virmelStyleCard from "@scout-for-lol/data/src/review/prompts/style-cards/virmel_style.json";

// Import lane contexts
import topLane from "@scout-for-lol/data/src/review/prompts/lanes/top.txt?raw";
import middleLane from "@scout-for-lol/data/src/review/prompts/lanes/middle.txt?raw";
import jungleLane from "@scout-for-lol/data/src/review/prompts/lanes/jungle.txt?raw";
import adcLane from "@scout-for-lol/data/src/review/prompts/lanes/adc.txt?raw";
import supportLane from "@scout-for-lol/data/src/review/prompts/lanes/support.txt?raw";
import genericLane from "@scout-for-lol/data/src/review/prompts/lanes/generic.txt?raw";

// Import base prompt template (user prompt for review text stage)
import basePrompt from "@scout-for-lol/data/src/review/prompts/user/2-review-text.txt?raw";

/**
 * Built-in personalities (from prompt files)
 */
const RAW_BUILTIN_PERSONALITIES: Personality[] = [
  {
    id: "aaron",
    metadata: PersonalityMetadataSchema.parse(aaronJson),
    instructions: aaronTxt,
    styleCard: JSON.stringify(aaronStyleCard),
  },
  {
    id: "brian",
    metadata: PersonalityMetadataSchema.parse(brianJson),
    instructions: brianTxt,
    styleCard: JSON.stringify(brianStyleCard),
  },
  {
    id: "caitlyn",
    metadata: PersonalityMetadataSchema.parse(caitlynJson),
    instructions: caitlynTxt,
    styleCard: JSON.stringify(caitlynStyleCard),
  },
  {
    id: "colin",
    metadata: PersonalityMetadataSchema.parse(colinJson),
    instructions: colinTxt,
    styleCard: JSON.stringify(colinStyleCard),
  },
  {
    id: "danny",
    metadata: PersonalityMetadataSchema.parse(dannyJson),
    instructions: dannyTxt,
    styleCard: JSON.stringify(dannyStyleCard),
  },
  {
    id: "edward",
    metadata: PersonalityMetadataSchema.parse(edwardJson),
    instructions: edwardTxt,
    styleCard: JSON.stringify(edwardStyleCard),
  },
  {
    id: "hirza",
    metadata: PersonalityMetadataSchema.parse(hirzaJson),
    instructions: hirzaTxt,
    styleCard: JSON.stringify(hirzaStyleCard),
  },
  {
    id: "irfan",
    metadata: PersonalityMetadataSchema.parse(irfanJson),
    instructions: irfanTxt,
    styleCard: JSON.stringify(irfanStyleCard),
  },
  {
    id: "jerred",
    metadata: PersonalityMetadataSchema.parse(jerredJson),
    instructions: jerredTxt,
    styleCard: JSON.stringify(jerredStyleCard),
  },
  {
    id: "long",
    metadata: PersonalityMetadataSchema.parse(longJson),
    instructions: longTxt,
    styleCard: JSON.stringify(longStyleCard),
  },
  {
    id: "nekoryan",
    metadata: PersonalityMetadataSchema.parse(nekoryanJson),
    instructions: nekoryanTxt,
    styleCard: JSON.stringify(nekoryanStyleCard),
  },
  {
    id: "richard",
    metadata: PersonalityMetadataSchema.parse(richardJson),
    instructions: richardTxt,
    styleCard: JSON.stringify(richardStyleCard),
  },
  {
    id: "virmel",
    metadata: PersonalityMetadataSchema.parse(virmelJson),
    instructions: virmelTxt,
    styleCard: JSON.stringify(virmelStyleCard),
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
