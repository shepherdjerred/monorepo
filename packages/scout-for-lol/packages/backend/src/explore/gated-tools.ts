import type { DiscordAccountId, DiscordChannelId } from "@scout-for-lol/data";
import {
  createBucksExploreTools,
  type BucksExploreCapability,
} from "#src/explore/tools/bucks-tools.ts";
import {
  createMvpVotesExploreTools,
  type MvpVotesExploreCapability,
} from "#src/explore/tools/mvp-votes-tools.ts";
import { createDareExploreTools } from "#src/explore/tools/dare-tool-definitions.ts";
import { createChallengeExploreTools } from "#src/explore/tools/challenge-tools.ts";
import { createCreationExploreTools } from "#src/explore/creation/tools.ts";
import type { CreationCapability } from "#src/explore/creation/capability.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

/**
 * Explore tools that exist only when a turn's guilds have that capability.
 * ScoutQL and league-reference tools stay in the agent so they can share
 * query state; these are independent reads of Postgres-backed features.
 */
export function createGatedExploreTools(input: {
  bucksCapability: BucksExploreCapability | null;
  mvpVotesCapability: MvpVotesExploreCapability | null;
  daresEnabled: boolean;
  challengesEnabled: boolean;
  creationCapability: CreationCapability | null;
  requesterId: DiscordAccountId;
  conversationId: string;
  originChannelId: DiscordChannelId | null;
  track: ToolTracker;
}) {
  return {
    ...(input.bucksCapability === null
      ? {}
      : createBucksExploreTools({
          capability: input.bucksCapability,
          requesterId: input.requesterId,
          track: input.track,
        })),
    ...(input.mvpVotesCapability === null
      ? {}
      : createMvpVotesExploreTools({
          capability: input.mvpVotesCapability,
          track: input.track,
        })),
    ...(input.bucksCapability === null || !input.daresEnabled
      ? {}
      : createDareExploreTools({
          capability: input.bucksCapability,
          requesterId: input.requesterId,
          conversationId: input.conversationId,
          originChannelId: input.originChannelId,
          track: input.track,
        })),
    ...(input.challengesEnabled
      ? createChallengeExploreTools({
          requesterId: input.requesterId,
          track: input.track,
        })
      : {}),
    ...createCreationExploreTools({
      capability: input.creationCapability,
      requesterId: input.requesterId,
      track: input.track,
    }),
  };
}
