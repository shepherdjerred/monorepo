/**
 * Timeline summary processing for the review pipeline
 *
 * Handles chunked timeline processing with parallel execution and aggregation.
 * Extracted from pipeline.ts to reduce file size.
 */

import type {
  StageTrace,
  TimelineChunkTrace,
  PipelineStageName,
  OpenAIClient,
  ModelConfig,
} from "./pipeline-types.ts";
import type { RawMatch } from "@scout-for-lol/data/league/raw-match.schema";
import type { RawTimeline } from "@scout-for-lol/data/league/raw-timeline.schema";
import {
  generateTimelineSummary,
  generateTimelineChunkSummary,
  aggregateTimelineChunks,
} from "./timeline-stages.ts";
import {
  splitTimelineIntoChunks,
  enrichTimelineChunk,
} from "./timeline-chunker.ts";
import {
  DEFAULT_TIMELINE_CHUNK_MODEL,
  DEFAULT_TIMELINE_AGGREGATE_MODEL,
  TIMELINE_CHUNK_SYSTEM_PROMPT,
  TIMELINE_CHUNK_USER_PROMPT,
  TIMELINE_AGGREGATE_SYSTEM_PROMPT,
  TIMELINE_AGGREGATE_USER_PROMPT,
} from "./pipeline-defaults.ts";

/** Extended progress reporter options */
export type ProgressReportOptions = {
  chunkIndex?: number;
  chunkTotal?: number;
  customMessage?: string;
};

export type TimelineSummaryResult = {
  text: string;
  trace: StageTrace;
  chunkTraces?: TimelineChunkTrace[];
  chunkSummaries?: string[];
};

export type TimelineSummaryParams = {
  rawTimeline: RawTimeline;
  rawMatch: RawMatch;
  laneContext: string;
  client: OpenAIClient;
  model: ModelConfig;
  systemPrompt: string;
  userPrompt: string;
  reportProgress: (
    stage: PipelineStageName,
    options?: ProgressReportOptions,
  ) => void;
};

/**
 * Run timeline summary with chunked processing for large timelines
 *
 * For games with 1 or fewer chunks (short games), uses the original non-chunked approach.
 * For longer games, splits into 10-minute chunks, processes in parallel, and aggregates.
 */
export async function runTimelineSummaryWithChunks(
  params: TimelineSummaryParams,
): Promise<TimelineSummaryResult | undefined> {
  const {
    rawTimeline,
    rawMatch,
    laneContext,
    client,
    model,
    systemPrompt,
    userPrompt,
    reportProgress,
  } = params;

  // Split timeline into 10-minute chunks
  const chunks = splitTimelineIntoChunks(rawTimeline);

  // If only 1 chunk, use the original non-chunked approach (small games)
  if (chunks.length <= 1) {
    reportProgress("timeline-summary");
    const result = await generateTimelineSummary({
      rawTimeline,
      rawMatch,
      laneContext,
      client,
      model,
      systemPrompt,
      userPrompt,
    });
    return { text: result.text, trace: result.trace };
  }

  // Process chunks in parallel
  const chunkTraces: TimelineChunkTrace[] = [];
  const chunkSummaries: string[] = [];

  // Report progress for chunk processing (all chunks processed in parallel)
  reportProgress("timeline-chunk", {
    chunkTotal: chunks.length,
    customMessage: `Processing ${chunks.length.toString()} timeline chunks in parallel...`,
  });

  const chunkResults = await Promise.all(
    chunks.map(async (chunk) => {
      const enrichedChunk = enrichTimelineChunk(chunk, rawMatch);
      const result = await generateTimelineChunkSummary({
        enrichedChunk,
        client,
        model: DEFAULT_TIMELINE_CHUNK_MODEL,
        systemPrompt: TIMELINE_CHUNK_SYSTEM_PROMPT,
        userPrompt: TIMELINE_CHUNK_USER_PROMPT,
      });
      return { chunk, result };
    }),
  );

  // Collect results in order
  for (const { chunk, result } of chunkResults) {
    chunkTraces.push({
      chunkIndex: chunk.chunkIndex,
      timeRange: chunk.timeRange,
      trace: result.trace,
    });
    chunkSummaries.push(result.text);
  }

  // Report progress for aggregation
  reportProgress("timeline-aggregate", {
    customMessage: "Aggregating timeline summaries...",
  });

  // Aggregate chunk summaries into a cohesive narrative
  const aggregateResult = await aggregateTimelineChunks({
    chunkSummaries,
    gameDurationSeconds: rawMatch.info.gameDuration,
    client,
    model: DEFAULT_TIMELINE_AGGREGATE_MODEL,
    systemPrompt: TIMELINE_AGGREGATE_SYSTEM_PROMPT,
    userPrompt: TIMELINE_AGGREGATE_USER_PROMPT,
  });

  return {
    text: aggregateResult.text,
    trace: aggregateResult.trace,
    chunkTraces,
    chunkSummaries,
  };
}
