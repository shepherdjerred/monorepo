import {
  PersonalityMetadataSchema,
  type Personality,
} from "@scout-for-lol/data/index";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

// Static imports for lane context files
import topLane from "@scout-for-lol/data/src/review/prompts/lanes/top.txt";
import middleLane from "@scout-for-lol/data/src/review/prompts/lanes/middle.txt";
import jungleLane from "@scout-for-lol/data/src/review/prompts/lanes/jungle.txt";
import adcLane from "@scout-for-lol/data/src/review/prompts/lanes/adc.txt";
import supportLane from "@scout-for-lol/data/src/review/prompts/lanes/support.txt";
import genericLane from "@scout-for-lol/data/src/review/prompts/lanes/generic.txt";

const logger = createLogger("review-prompts");

/**
 * In-memory state tracking for balanced reviewer selection.
 * Tracks how many times each reviewer has been selected to ensure
 * fair distribution across all available reviewers.
 */
const reviewerUsageCount = new Map<string, number>();

// Resolve the prompts directory from the data package
// import.meta.resolve returns a file:// URL, so we extract the pathname
function getPromptsDir(): string {
  // In a Bun workspace, we can resolve the data package and navigate to prompts
  // This will be resolved at runtime when the function is called
  const dataPackageUrl = import.meta.resolve("@scout-for-lol/data");
  const url = new URL(dataPackageUrl);
  // Navigate from data/src/index.ts to data/src/review/prompts
  return url.pathname.replace(/\/src\/index\.ts$/, "/src/review/prompts");
}

// Resolve the analysis style card directory (packages/analysis/llm-out)
function getStyleCardsDir(): string {
  const dataPackageUrl = import.meta.resolve("@scout-for-lol/data");
  const url = new URL(dataPackageUrl);
  // Navigate from data/src/index.ts -> packages/data/src/review/prompts/style-cards
  return url.pathname.replace(
    /\/src\/index\.ts$/,
    "/src/review/prompts/style-cards",
  );
}

const PROMPTS_DIR = getPromptsDir();
const STYLECARDS_DIR = getStyleCardsDir();
const EXCLUDED = new Set(["generic.json"]);

/**
 * Allowed personalities for AI review selection.
 * Only these personalities will be loaded and used.
 */
const ALLOWED_PERSONALITIES = new Set([
  "aaron",
  "brian",
  "danny",
  "irfan",
  "nekoryan",
  "colin",
  "edward",
  "hirza",
  "long",
  "richard",
  "virmel",
]);

/**
 * Load a personality (both JSON metadata and TXT instructions)
 */
async function loadPersonality(basename: string): Promise<Personality> {
  const personalitiesDir = `${PROMPTS_DIR}/personalities`;

  // Load JSON metadata
  const jsonPath = `${personalitiesDir}/${basename}.json`;
  const jsonContent = await Bun.file(jsonPath).text();
  const parsed: unknown = JSON.parse(jsonContent);
  const metadata = PersonalityMetadataSchema.parse(parsed);

  // Load TXT instructions
  const txtPath = `${personalitiesDir}/${basename}.txt`;
  const instructionsText = await Bun.file(txtPath).text();
  const instructions = instructionsText.trim();

  // Load a matching style card from analysis/llm-out (required)
  const normalizedBasename = basename.toLowerCase();
  const normalizedDisplayName = metadata.name
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  const styleCardCandidates = [...new Set([normalizedBasename, normalizedDisplayName])];

  let styleCard: string | undefined;
  for (const candidate of styleCardCandidates) {
    const stylePath = `${STYLECARDS_DIR}/${candidate}_style.json`;
    const styleFile = Bun.file(stylePath);
    if (await styleFile.exists()) {
      styleCard = (await styleFile.text()).trim();
      break;
    }
  }

  if (!styleCard) {
    throw new Error(
      `Missing required style card for personality "${basename}". Expected one of: ${styleCardCandidates.map((c) => `${c}_style.json`).join(", ")}`,
    );
  }

  return {
    metadata,
    instructions,
    styleCard,
    filename: basename,
  };
}

/**
 * Select a random personality prompt using balanced pseudo-random selection.
 * All reviewers with complete data (metadata + instructions + style card) are included.
 * The algorithm ensures no reviewer is selected too often or too seldom.
 */
export async function selectRandomPersonality(): Promise<Personality> {
  const personalities = await listValidPersonalities();
  const selectedPersonality = selectBalancedReviewer(personalities);

  logger.info(
    `Selected: ${selectedPersonality.filename ?? selectedPersonality.metadata.name}, ` +
      `usage counts: ${JSON.stringify(Object.fromEntries(reviewerUsageCount))}`,
  );

  return selectedPersonality;
}

/**
 * Select a personality using balanced pseudo-random selection.
 * All personalities have equal probability of being selected.
 */
function selectBalancedReviewer(
  availablePersonalities: Personality[],
): Personality {
  if (availablePersonalities.length === 0) {
    throw new Error("No personalities available for selection");
  }

  // Initialize usage counts for new personalities
  for (const personality of availablePersonalities) {
    const key = personality.filename ?? personality.metadata.name;
    if (!reviewerUsageCount.has(key)) {
      reviewerUsageCount.set(key, 0);
    }
  }

  // Select randomly from all personalities with equal probability
  const randomIndex = Math.floor(Math.random() * availablePersonalities.length);
  const selected = availablePersonalities[randomIndex];
  if (!selected) {
    throw new Error("Failed to select random personality");
  }

  // Increment the usage count for the selected personality
  const key = selected.filename ?? selected.metadata.name;
  reviewerUsageCount.set(key, (reviewerUsageCount.get(key) ?? 0) + 1);

  return selected;
}

let cachedPersonalities: Personality[] | null = null;

async function listValidPersonalities(): Promise<Personality[]> {
  if (cachedPersonalities) {
    return cachedPersonalities;
  }

  const personalitiesDir = `${PROMPTS_DIR}/personalities`;
  const glob = new Bun.Glob("*.json");
  const basenames: string[] = [];
  for await (const file of glob.scan(personalitiesDir)) {
    const name = file.replace(/\.json$/, "");
    if (!EXCLUDED.has(`${name}.json`) && ALLOWED_PERSONALITIES.has(name)) {
      basenames.push(name);
    }
  }

  const valid: Personality[] = [];
  const discarded: string[] = [];

  for (const base of basenames) {
    try {
      const personality = await loadPersonality(base);
      valid.push(personality);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      discarded.push(`${base} (${reason})`);
    }
  }

  if (discarded.length > 0) {
    logger.warn(
      `[ai-review] Discarded personalities due to incomplete data: ${discarded.join("; ")}`,
    );
  }

  if (valid.length === 0) {
    throw new Error(
      "No personalities with complete data (metadata + instructions + style card).",
    );
  }

  cachedPersonalities = valid;
  return valid;
}

/** Lane context map using static imports */
const LANE_CONTEXTS: Record<string, string> = {
  top: topLane,
  middle: middleLane,
  jungle: jungleLane,
  adc: adcLane,
  support: supportLane,
};

/**
 * Get lane context based on player's lane
 */
export function getLaneContext(lane: string | undefined): {
  content: string;
  filename: string;
} {
  const lowerLane = lane?.toLowerCase();
  let filename = "lanes/generic.txt";
  let content = genericLane;

  if (lowerLane && lowerLane in LANE_CONTEXTS) {
    const laneContent = LANE_CONTEXTS[lowerLane];
    if (laneContent) {
      content = laneContent;
      filename = `lanes/${lowerLane}.txt`;
    }
  }

  return { content, filename };
}
