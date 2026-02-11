/**
 * Individual stage functions for the unified AI review pipeline
 *
 * Each stage is a pure function that takes dependencies as parameters.
 * All JSON data is minified before being sent to reduce token usage.
 */

import type { ArenaMatch, CompletedMatch } from "@shepherdjerred/scout-data/model/index";
import type { RawMatch } from "@shepherdjerred/scout-data/league/raw-match.schema";
import type { OpenAIClient, ModelConfig, StageTrace, ImageGenerationTrace } from "./pipeline-types.ts";
import type { Personality } from "./prompts.ts";
import { replaceTemplateVariables, selectRandomImagePrompts } from "./prompts.ts";
import { buildPromptVariables, extractMatchData } from "./generator-helpers.ts";
import type { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { minifyJson, replacePromptVariables, callOpenAI } from "./pipeline-utils.ts";

// ============================================================================
// Stage 1a: Timeline Summary
// Note: Timeline-related stages are in timeline-stages.ts to keep this file under 500 lines.
// Import from timeline-stages.ts directly when needed.
// ============================================================================

// ============================================================================
// Stage 1b: Match Summary
// ============================================================================

/**
 * Stage 1b: Summarize match data for a single player
 *
 * Takes raw match data from Riot API to generate a factual summary
 * of the player's performance. This summary is used by the personality
 * reviewer instead of raw JSON.
 */
export async function generateMatchSummary(params: {
  match: CompletedMatch | ArenaMatch;
  rawMatch: RawMatch;
  playerIndex: number;
  client: OpenAIClient;
  model: ModelConfig;
  systemPrompt: string;
  userPrompt: string;
}): Promise<{ text: string; trace: StageTrace }> {
  const { match, rawMatch, playerIndex, client, model, systemPrompt, userPrompt: userPromptTemplate } = params;

  const player = match.players[playerIndex] ?? match.players[0];
  if (!player) {
    throw new Error("No player found for match summary");
  }

  const playerName = player.playerConfig.alias;
  const playerChampion = player.champion.championName;
  let lane = "unknown lane";
  if (match.queueType === "arena") {
    lane = "arena";
  } else if ("lane" in player && typeof player.lane === "string") {
    lane = player.lane;
  }

  const userPrompt = replacePromptVariables(userPromptTemplate, {
    PLAYER_NAME: playerName,
    PLAYER_CHAMPION: playerChampion,
    PLAYER_LANE: lane,
    MATCH_DATA: minifyJson({
      processedMatch: match,
      rawMatch,
    }),
  });

  return callOpenAI({
    client,
    model,
    systemPrompt,
    userPrompt,
  });
}

// ============================================================================
// Stage 2: Review Text (Personality)
// ============================================================================

/**
 * Minify a JSON string (used for style card)
 */
function minifyJsonString(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    return trimmed;
  }
}

/**
 * Stage 2: Generate review text using personality
 *
 * Takes text summaries (NOT raw JSON) from stages 1a and 1b,
 * and generates the final review using the personality's voice.
 */
export async function generateReviewTextStage(params: {
  match: CompletedMatch | ArenaMatch;
  personality: Personality;
  laneContext: string;
  playerIndex: number;
  matchSummary: string;
  timelineSummary?: string;
  client: OpenAIClient;
  model: ModelConfig;
  systemPrompt: string;
  userPrompt: string;
}): Promise<{ text: string; reviewerName: string; playerName: string; trace: StageTrace }> {
  const {
    match,
    personality,
    laneContext,
    playerIndex,
    matchSummary,
    timelineSummary,
    client,
    model,
    systemPrompt: systemPromptTemplate,
    userPrompt: userPromptTemplate,
  } = params;

  const { matchData } = extractMatchData(match, playerIndex);

  // Build prompt variables using the text summaries instead of raw JSON
  const promptVariables = buildPromptVariables({
    matchData,
    personality,
    laneContext,
    match,
    playerIndex,
    matchAnalysis: matchSummary, // Use match summary text
    ...(timelineSummary !== undefined && { timelineSummary }),
  });

  const userPrompt = replaceTemplateVariables(userPromptTemplate, promptVariables);
  const systemPrompt = replacePromptVariables(systemPromptTemplate, {
    PERSONALITY_INSTRUCTIONS: personality.instructions,
    STYLE_CARD: minifyJsonString(personality.styleCard),
  });

  const { text, trace } = await callOpenAI({
    client,
    model,
    systemPrompt,
    userPrompt,
  });

  return {
    text,
    reviewerName: promptVariables.reviewerName,
    playerName: promptVariables.playerName,
    trace,
  };
}

// ============================================================================
// Stage 3: Image Description
// ============================================================================

/**
 * Build the image inspirations section for the prompt
 *
 * @param selectedPrompts - Array of already-selected image prompts
 * @returns Formatted string for the prompt, or empty string if no prompts
 */
function buildImageInspirationsSection(selectedPrompts: string[]): string {
  if (selectedPrompts.length === 0) {
    return "";
  }

  const formattedPrompts = selectedPrompts.map((p) => `- ${p}`).join("\n");
  return `\n\nFor visual inspiration, consider incorporating elements from these themes:\n${formattedPrompts}`;
}

/**
 * Stage 3: Generate image description from review text
 *
 * Takes the review text and turns it into a vivid art concept
 * that can be used for image generation.
 *
 * @param params.imagePrompts - Optional array of image prompts from personality metadata to influence the art concept
 */
export async function generateImageDescription(params: {
  reviewText: string;
  artStyle: string;
  client: OpenAIClient;
  model: ModelConfig;
  systemPrompt: string;
  userPrompt: string;
  imagePrompts?: string[] | undefined;
}): Promise<{ text: string; trace: StageTrace; selectedImagePrompts: string[] }> {
  const { reviewText, artStyle, client, model, systemPrompt, userPrompt: userPromptTemplate, imagePrompts } = params;

  // Select 2-3 random image prompts from personality
  const selectedImagePrompts = selectRandomImagePrompts(imagePrompts);
  const imageInspirations = buildImageInspirationsSection(selectedImagePrompts);

  const userPrompt = replacePromptVariables(userPromptTemplate, {
    REVIEW_TEXT: reviewText,
    ART_STYLE: artStyle,
    IMAGE_INSPIRATIONS: imageInspirations,
  });

  const { text, trace } = await callOpenAI({
    client,
    model,
    systemPrompt,
    userPrompt,
  });

  return { text, trace, selectedImagePrompts };
}

// ============================================================================
// Stage 4: Image Generation (Gemini)
// ============================================================================

const GeminiImagePartSchema = z
  .object({
    inlineData: z.object({
      data: z.string(),
    }),
  })
  .loose();

const GeminiResponseSchema = z
  .object({
    response: z.object({
      candidates: z.array(
        z.object({
          content: z.object({
            parts: z.array(GeminiImagePartSchema),
          }),
        }),
      ),
    }),
  })
  .loose();

/**
 * Stage 4: Generate image from description using Gemini
 *
 * Takes the image description and generates an actual image.
 */
export async function generateImage(params: {
  imageDescription: string;
  geminiClient: GoogleGenerativeAI;
  model: string;
  timeoutMs: number;
  userPrompt: string;
}): Promise<{ imageBase64: string; trace: ImageGenerationTrace }> {
  const { imageDescription, geminiClient, model, timeoutMs, userPrompt: userPromptTemplate } = params;

  const geminiModel = geminiClient.getGenerativeModel({ model });
  // Replace variables in prompt template
  // Note: ART_STYLE is already embedded in IMAGE_DESCRIPTION from step 3
  const prompt = replacePromptVariables(userPromptTemplate, {
    IMAGE_DESCRIPTION: imageDescription,
  });

  const startTime = Date.now();

  // Add timeout protection
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Gemini API call timed out after ${timeoutMs.toString()}ms`));
    }, timeoutMs);
  });

  const resultRaw = await Promise.race([geminiModel.generateContent(prompt), timeoutPromise]);
  const durationMs = Date.now() - startTime;

  const result = GeminiResponseSchema.parse(resultRaw);

  if (result.response.candidates.length === 0) {
    throw new Error("No candidates returned from Gemini");
  }

  const firstCandidate = result.response.candidates[0];
  if (!firstCandidate) {
    throw new Error("No candidates returned from Gemini");
  }

  const parts = firstCandidate.content.parts;
  if (parts.length === 0) {
    throw new Error("No parts found in response");
  }

  const imagePart = parts[0];
  if (!imagePart) {
    throw new Error("No image part found in response");
  }

  const imageBase64 = imagePart.inlineData.data;
  if (imageBase64.length === 0) {
    throw new Error("Empty image data in response");
  }

  // Estimate image size from base64 (base64 is ~33% larger than binary)
  const imageSizeBytes = Math.floor((imageBase64.length * 3) / 4);

  return {
    imageBase64,
    trace: {
      request: { prompt },
      response: {
        imageGenerated: true,
        imageSizeBytes,
      },
      model,
      durationMs,
    },
  };
}
