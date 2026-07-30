import {
  CaseArtifactSchema,
  type CaseArtifact,
  type PerformanceSliceSchema,
} from "#shared/schema.ts";
import type { z } from "zod";

type PerformanceSlice = z.infer<typeof PerformanceSliceSchema>;

export function makeCaseArtifact(overrides: {
  matchId: string;
  playerName: string;
  puuid: string;
  championName: string;
  performanceSlice: PerformanceSlice;
  styleKey: string;
}): CaseArtifact {
  return CaseArtifactSchema.parse({
    schemaVersion: 1,
    matchId: overrides.matchId,
    targetPlayerName: overrides.playerName,
    targetPlayerPuuid: overrides.puuid,
    targetPlayerIndex: 3,
    championName: overrides.championName,
    queueType: "RANKED_SOLO_5x5",
    performanceSlice: overrides.performanceSlice,
    styleKey: overrides.styleKey,
    modelSettings: {
      timelineSummary: {
        model: "gpt-5.4-mini",
        maxTokens: 6000,
        temperature: 0.3,
      },
      timelineChunk: {
        model: "gpt-5.4-mini",
        maxTokens: 2000,
        temperature: 0.3,
      },
      timelineAggregate: {
        model: "gpt-5.4-mini",
        maxTokens: 4000,
        temperature: 0.3,
      },
      matchSummary: {
        model: "gpt-5.4-mini",
        maxTokens: 6000,
        temperature: 0.4,
      },
      reviewText: { model: "gpt-5.6-sol", maxTokens: 3000 },
    },
    context: {
      deterministicFacts: `${overrides.playerName} went 10/1/8`,
      matchSummary: "A convincing win.",
      timelineSummary: "The lead grew after the first dragon.",
      laneContext: "Won lane.",
      playerHistory: "Usually plays tanks.",
      patchContext: "Patch 26.15",
      styleCard: `${overrides.styleKey} style card`,
      personalityInstructions: "Be funny and specific.",
      selectedBehaviors: ["tease the player"],
      renderedPrompts: {
        matchSummary: {
          systemPrompt: "Summarize the match.",
          userPrompt: "Summarize these match facts.",
        },
        timeline: {
          mode: "chunked",
          chunks: [
            {
              chunkIndex: 0,
              timeRange: "0:00 - 10:00",
              systemPrompt: "Summarize this timeline chunk.",
              userPrompt: "Opening timeline events.",
            },
            {
              chunkIndex: 1,
              timeRange: "10:00 - 20:00",
              systemPrompt: "Summarize this timeline chunk.",
              userPrompt: "Closing timeline events.",
            },
          ],
          aggregate: {
            systemPrompt: "Aggregate timeline chunks.",
            userPrompt: "Combine the ordered summaries.",
          },
        },
        reviewText: {
          systemPrompt: "Write a post-match review.",
          userPrompt: "Review this match.",
        },
      },
    },
    rawMatch: { metadata: { matchId: overrides.matchId } },
    rawTimeline: { frames: [] },
    processedMatch: { winningTeam: "BLUE" },
    source: {
      bucket: "scout-beta",
      matchKey: `games/2026/07/28/${overrides.matchId}/match.json`,
      timelineKey: `games/2026/07/28/${overrides.matchId}/timeline.json`,
      matchSha256: "a".repeat(64),
      timelineSha256: "b".repeat(64),
    },
  });
}
