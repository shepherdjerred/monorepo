/**
 * Timeline enrichment utilities
 *
 * Provides helpful context data that makes the raw timeline easier for AI to interpret.
 * Adds a participant lookup table for champion names and team names.
 */

import type { RawMatch, RawTimeline } from "@scout-for-lol/data";

/**
 * Participant info for the lookup table
 */
export type ParticipantLookup = {
  participantId: number;
  championName: string;
  team: "Blue" | "Red";
  summonerName: string;
};

/**
 * Enrichment context to include with raw timeline data
 */
export type TimelineEnrichment = {
  /** Lookup table mapping participant IDs (1-10) to champion/team info */
  participants: ParticipantLookup[];
  /** Game duration in seconds */
  gameDurationSeconds: number;
};

/**
 * Build a participant lookup table from raw match data.
 *
 * Maps participant IDs to human-readable champion names and
 * team names ("Blue"/"Red" instead of 100/200).
 */
export function buildParticipantLookup(
  rawMatch: RawMatch,
): ParticipantLookup[] {
  return rawMatch.info.participants.map((p, index) => ({
    participantId: index + 1,
    championName: p.championName,
    team: p.teamId === 100 ? "Blue" : "Red",
    summonerName:
      p.riotIdGameName != null && p.riotIdGameName.length > 0
        ? p.riotIdGameName
        : p.summonerName,
  }));
}

/**
 * Build enrichment context for a timeline
 *
 * This creates a lookup table that maps participant IDs to human-readable
 * champion names and team names ("Blue"/"Red" instead of 100/200).
 */
export function buildTimelineEnrichment(
  rawMatch: RawMatch,
): TimelineEnrichment {
  return {
    participants: buildParticipantLookup(rawMatch),
    gameDurationSeconds: rawMatch.info.gameDuration,
  };
}

/**
 * Timeline data with enrichment context
 *
 * This is what gets sent to OpenAI - the full raw timeline plus
 * a participant lookup table for human-readable names.
 */
export type EnrichedTimelineData = {
  /** Full raw timeline from Riot API */
  timeline: RawTimeline;
  /** Enrichment context (participant mapping) */
  context: TimelineEnrichment;
};

/**
 * Create enriched timeline data for AI consumption
 */
export function enrichTimelineData(
  rawTimeline: RawTimeline,
  rawMatch: RawMatch,
): EnrichedTimelineData {
  return {
    timeline: rawTimeline,
    context: buildTimelineEnrichment(rawMatch),
  };
}
