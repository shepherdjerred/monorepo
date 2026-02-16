/**
 * Timeline summarization stages for the AI review pipeline
 *
 * This module contains the timeline-related stage functions:
 * - generateTimelineChunkSummary: Summarize a single chunk of timeline
 * - aggregateTimelineChunks: Combine chunk summaries into a narrative
 *
 * Extracted from pipeline-stages.ts to reduce file size.
 */

import type { RawTimeline } from "@scout-for-lol/data/league/raw-timeline.schema";
import type { RawMatch } from "@scout-for-lol/data/league/raw-match.schema";
import type { OpenAIClient, ModelConfig, StageTrace } from "./pipeline-types.ts";
import { enrichTimelineData } from "./timeline-enricher.ts";
import type { EnrichedTimelineChunk } from "./timeline-chunker.ts";
import { minifyJson, replacePromptVariables, callOpenAI } from "./pipeline-utils.ts";

// ============================================================================
// Stage 1a: Timeline Summary (Legacy - Full Timeline)
// ============================================================================

/**
 * Stage 1a: Summarize raw timeline data into a narrative (legacy non-chunked)
 *
 * Takes raw timeline data from Riot API along with match data for participant
 * context, and generates a narrative summary of how the game unfolded.
 */
export async function generateTimelineSummary(params: {
  rawTimeline: RawTimeline;
  rawMatch: RawMatch;
  laneContext: string;
  client: OpenAIClient;
  model: ModelConfig;
  systemPrompt: string;
  userPrompt: string;
}): Promise<{ text: string; trace: StageTrace }> {
  const {
    rawTimeline,
    rawMatch,
    laneContext,
    client,
    model,
    systemPrompt: systemPromptTemplate,
    userPrompt: userPromptTemplate,
  } = params;

  const enrichedData = enrichTimelineData(rawTimeline, rawMatch);

  const systemPrompt = replacePromptVariables(systemPromptTemplate, {
    LANE_CONTEXT: laneContext,
  });
  const userPrompt = replacePromptVariables(userPromptTemplate, {
    TIMELINE_DATA: minifyJson(enrichedData),
  });

  return callOpenAI({
    client,
    model,
    systemPrompt,
    userPrompt,
  });
}

// ============================================================================
// Stage 1a (Chunked): Timeline Chunk Summary
// ============================================================================

/**
 * Stage 1a (Chunked): Summarize a single chunk of timeline data
 *
 * Takes a chunk of timeline data (typically 10 minutes) and generates
 * a summary of what happened during that time window.
 */
export async function generateTimelineChunkSummary(params: {
  enrichedChunk: EnrichedTimelineChunk;
  client: OpenAIClient;
  model: ModelConfig;
  systemPrompt: string;
  userPrompt: string;
}): Promise<{ text: string; trace: StageTrace }> {
  const { enrichedChunk, client, model, systemPrompt: systemPromptTemplate, userPrompt: userPromptTemplate } = params;

  const { chunk, participants, gameDurationSeconds } = enrichedChunk;

  const systemPrompt = replacePromptVariables(systemPromptTemplate, {
    CHUNK_INDEX: (chunk.chunkIndex + 1).toString(),
    TOTAL_CHUNKS: chunk.totalChunks.toString(),
    TIME_RANGE: chunk.timeRange,
  });

  const chunkData = {
    timeRange: chunk.timeRange,
    participants,
    gameDurationSeconds,
    frames: chunk.frames,
    events: chunk.events,
  };

  const userPrompt = replacePromptVariables(userPromptTemplate, {
    TIME_RANGE: chunk.timeRange,
    CHUNK_DATA: minifyJson(chunkData),
  });

  return callOpenAI({
    client,
    model,
    systemPrompt,
    userPrompt,
  });
}

// ============================================================================
// Stage 1a (Aggregation): Combine Timeline Chunk Summaries
// ============================================================================

/**
 * Stage 1a (Aggregation): Combine multiple chunk summaries into a cohesive narrative
 *
 * Takes the individual chunk summaries and produces a unified timeline
 * narrative that reads smoothly and identifies cross-chunk patterns.
 */
export async function aggregateTimelineChunks(params: {
  chunkSummaries: string[];
  gameDurationSeconds: number;
  client: OpenAIClient;
  model: ModelConfig;
  systemPrompt: string;
  userPrompt: string;
}): Promise<{ text: string; trace: StageTrace }> {
  const { chunkSummaries, gameDurationSeconds, client, model, systemPrompt, userPrompt: userPromptTemplate } = params;

  const minutes = Math.floor(gameDurationSeconds / 60);
  const seconds = gameDurationSeconds % 60;
  const gameDuration = `${minutes.toString()}:${seconds.toString().padStart(2, "0")}`;

  const formattedSummaries = chunkSummaries
    .map((summary, index) => {
      const startMin = index * 10;
      const endMin = Math.min((index + 1) * 10, Math.ceil(gameDurationSeconds / 60));
      return `## ${startMin.toString()}:00 - ${endMin.toString()}:00\n${summary}`;
    })
    .join("\n\n");

  const userPrompt = replacePromptVariables(userPromptTemplate, {
    GAME_DURATION: gameDuration,
    CHUNK_SUMMARIES: formattedSummaries,
  });

  return callOpenAI({
    client,
    model,
    systemPrompt,
    userPrompt,
  });
}
