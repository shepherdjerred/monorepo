import {
  DiscordChannelIdSchema,
  type DiscordAccountId,
  type DiscordChannelId,
} from "@scout-for-lol/data";
import type { BucksExploreCapability } from "#src/explore/bucks-tools.ts";
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
  const [v2, v3, relational] = await Promise.all([
    isPolicyEnabled("dare_v2", { server: capability.serverId }),
    isPolicyEnabled("dare_sql_v3", { server: capability.serverId }),
    isPolicyEnabled("scoutql_relational_enabled", {
      server: capability.serverId,
    }),
  ]);
  return (v2 || v3) && relational;
}

export function dareDraftChannel(
  input: DareExploreToolsInput,
): DiscordChannelId {
  return DiscordChannelIdSchema.parse(
    input.originChannelId ?? COMMON_DENOMINATOR_CHANNEL_ID,
  );
}
