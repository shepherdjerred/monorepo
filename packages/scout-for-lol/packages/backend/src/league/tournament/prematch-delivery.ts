import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
} from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";
import { send } from "#src/league/discord/channel.ts";
import { getChannelsSubscribedToPlayers } from "#src/database/index.ts";
import { channelsPassingQueueFilter } from "#src/league/tasks/notification-filters.ts";
import { buildLobbyPrematchEmbed } from "#src/league/tournament/prematch-card.ts";
import type { TournamentLobbyRecord } from "#src/league/tournament/lobby-store.ts";
import { tournamentPrematchTotal } from "#src/metrics/tournament.ts";

const logger = createLogger("tournament-prematch");

/**
 * Sends the prematch card for a lobby entering champ select.
 *
 * Delivery goes to the same channels a matchmade game would: every channel
 * subscribed to one of the lobby's players that also passes a `"custom"` queue
 * filter. A subscription with an explicit filter list must name `"custom"` —
 * that is the documented allow-list semantics, not an oversight.
 *
 * Returns the channel -> message ID map so the poller can hand it to the
 * ActiveGame row, which is what makes the post-match report reply to this
 * message through the unchanged `getPrematchMessageIdsForMatchIdOrEmpty` path.
 *
 * A channel that fails gets its own boundary: one dead channel must not
 * swallow the healthy ones behind it.
 */
export async function deliverLobbyPrematch(
  lobby: TournamentLobbyRecord,
): Promise<Record<string, string> | undefined> {
  const puuids = [...lobby.bluePuuids, ...lobby.redPuuids].map((puuid) =>
    LeaguePuuidSchema.parse(puuid),
  );
  const subscribed = await getChannelsSubscribedToPlayers(puuids);
  const channels = channelsPassingQueueFilter(subscribed, "custom");

  if (channels.length === 0) {
    logger.info(
      `No channel subscribes to lobby ${lobby.code}; nothing to announce`,
    );
    tournamentPrematchTotal.inc({ path: "no_destination" });
    return undefined;
  }

  const embed = buildLobbyPrematchEmbed(lobby);
  const messageIds: Record<string, string> = {};

  for (const destination of channels) {
    try {
      const message = await send(
        { embeds: [embed] },
        DiscordChannelIdSchema.parse(destination.channel),
        DiscordGuildIdSchema.parse(destination.serverId),
      );
      messageIds[destination.channel] = message.id;
    } catch (error) {
      logger.error(
        `Failed to announce lobby ${lobby.code} in ${destination.channel}`,
        error,
      );
    }
  }

  tournamentPrematchTotal.inc({ path: "declared_roster" });
  return Object.keys(messageIds).length === 0 ? undefined : messageIds;
}
