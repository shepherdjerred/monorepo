import {
  DiscordChannelIdSchema,
  type DiscordAccountId,
  type DiscordChannelId,
} from "@scout-for-lol/data";
import type { BucksExploreCapability } from "#src/explore/tools/bucks-tools.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { COMMON_DENOMINATOR_CHANNEL_ID } from "#src/discord/channels.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

export type DareExploreToolsInput = {
  capability: BucksExploreCapability;
  requesterId: DiscordAccountId;
  conversationId: string;
  originChannelId: DiscordChannelId | null;
  track: ToolTracker;
};

export async function dareExploreEnabled(
  capability: BucksExploreCapability | null,
): Promise<boolean> {
  if (capability === null) return false;
  return await isPolicyEnabled("bucks_dares_enabled", {
    server: capability.serverId,
  });
}

export function dareDraftChannel(
  input: DareExploreToolsInput,
): DiscordChannelId {
  return DiscordChannelIdSchema.parse(
    input.originChannelId ?? COMMON_DENOMINATOR_CHANNEL_ID,
  );
}
