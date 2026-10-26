import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { COMMON_DENOMINATOR_CHANNEL_ID } from "#src/discord/channels.ts";
import type { DareExploreCapability } from "#src/explore/tools/dare-capability.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";
import {
  DiscordChannelIdSchema,
  type DiscordAccountId,
  type DiscordChannelId,
} from "@scout-for-lol/data";

export type DareExploreToolsInput = {
  capability: DareExploreCapability;
  requesterId: DiscordAccountId;
  conversationId: string;
  originChannelId: DiscordChannelId | null;
  track: ToolTracker;
};

export async function dareExploreEnabled(
  capability: DareExploreCapability | null,
): Promise<boolean> {
  if (capability === null) return false;
  return await isPolicyEnabled("dares_enabled", {
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
