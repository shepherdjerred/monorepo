/**
 * Timeline chunking utilities
 *
 * Splits raw timeline data into time-based chunks for parallel processing.
 * This helps avoid token limits when processing long games.
 */

import type {
  RawTimeline,
  RawTimelineFrame,
  RawTimelineEvent,
} from "@scout-for-lol/data/league/raw-timeline.schema";
import type { RawMatch } from "@scout-for-lol/data/league/raw-match.schema";
import {
  type ParticipantLookup,
  buildParticipantLookup,
} from "./timeline-enricher.ts";

/** Duration of each chunk in milliseconds (10 minutes) */
export const CHUNK_DURATION_MS = 10 * 60 * 1000;

/**
 * A chunk of timeline data for a specific time window
 */
export type TimelineChunk = {
  /** Zero-based index of this chunk */
  chunkIndex: number;
  /** Total number of chunks */
  totalChunks: number;
  /** Start time of this chunk in milliseconds */
  startMs: number;
  /** End time of this chunk in milliseconds */
  endMs: number;
  /** Human-readable time range (e.g., "0:00 - 10:00") */
  timeRange: string;
  /** Frames that fall within this chunk's time window */
  frames: RawTimelineFrame[];
  /** All events from frames in this chunk */
  events: RawTimelineEvent[];
};

/**
 * Enriched chunk data ready for AI consumption
 */
export type EnrichedTimelineChunk = {
  /** The chunk data */
  chunk: TimelineChunk;
  /** Participant lookup table for human-readable names */
  participants: ParticipantLookup[];
  /** Game duration in seconds */
  gameDurationSeconds: number;
};

/**
 * Format milliseconds as MM:SS
 */
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString()}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Split a raw timeline into chunks of CHUNK_DURATION_MS
 *
 * Each chunk contains:
 * - Frames with timestamps in the chunk's time window
 * - All events from those frames
 *
 * @param rawTimeline - The raw timeline data from Riot API
 * @returns Array of timeline chunks, ordered by time
 */
export function splitTimelineIntoChunks(
  rawTimeline: RawTimeline,
): TimelineChunk[] {
  const frames = rawTimeline.info.frames;
  if (frames.length === 0) {
    return [];
  }

  // Find the last frame's timestamp to determine game duration
  const lastFrame = frames[frames.length - 1];
  if (!lastFrame) {
    return [];
  }
  const gameDurationMs = lastFrame.timestamp;

  // Calculate number of chunks needed
  const numChunks = Math.ceil(gameDurationMs / CHUNK_DURATION_MS);
  if (numChunks === 0) {
    return [];
  }

  const chunks: TimelineChunk[] = [];

  for (let i = 0; i < numChunks; i++) {
    const startMs = i * CHUNK_DURATION_MS;
    const endMs = Math.min((i + 1) * CHUNK_DURATION_MS, gameDurationMs);

    // Get frames that fall within this chunk's time window
    // Include a frame if its timestamp is >= startMs and < endMs
    // For the last chunk, include frames with timestamp <= endMs
    const chunkFrames = frames.filter((frame) => {
      if (i === numChunks - 1) {
        // Last chunk: include all remaining frames
        return frame.timestamp >= startMs;
      }
      return frame.timestamp >= startMs && frame.timestamp < endMs;
    });

    // Collect all events from the chunk's frames
    const chunkEvents: RawTimelineEvent[] = [];
    for (const frame of chunkFrames) {
      chunkEvents.push(...frame.events);
    }

    chunks.push({
      chunkIndex: i,
      totalChunks: numChunks,
      startMs,
      endMs,
      timeRange: `${formatTime(startMs)} - ${formatTime(endMs)}`,
      frames: chunkFrames,
      events: chunkEvents,
    });
  }

  return chunks;
}

/**
 * Enrich a timeline chunk with participant lookup data
 *
 * @param chunk - The timeline chunk to enrich
 * @param rawMatch - The raw match data for participant info
 * @returns Enriched chunk ready for AI consumption
 */
export function enrichTimelineChunk(
  chunk: TimelineChunk,
  rawMatch: RawMatch,
): EnrichedTimelineChunk {
  return {
    chunk,
    participants: buildParticipantLookup(rawMatch),
    gameDurationSeconds: rawMatch.info.gameDuration,
  };
}
