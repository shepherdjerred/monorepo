import type { DiscordAccountId } from "@scout-for-lol/data";
import type { CommunityPlayer } from "#src/trpc/router/consumer/community-insights.ts";

/** A tracked player of the server, with the Discord link that marks the viewer. */
export type ServerPlayer = CommunityPlayer & {
  discordId: DiscordAccountId | null;
};

/** Who a ladder row, award or duo names. */
export type PlayerRef = { playerId: number; alias: string; isYou: boolean };

export function playerRef(
  player: ServerPlayer,
  viewerDiscordId: DiscordAccountId,
): PlayerRef {
  return {
    playerId: player.id,
    alias: player.alias,
    isYou: player.discordId !== null && player.discordId === viewerDiscordId,
  };
}

/** Stable order for equal contenders: name, then id. */
export function byName(left: ServerPlayer, right: ServerPlayer): number {
  return (
    left.alias.toLowerCase().localeCompare(right.alias.toLowerCase()) ||
    left.id - right.id
  );
}
