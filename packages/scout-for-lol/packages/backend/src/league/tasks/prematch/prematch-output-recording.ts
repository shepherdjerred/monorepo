import type {
  DiscordGuildId,
  PlayerConfigEntry,
  QueueType,
  RawCurrentGameInfo,
} from "@scout-for-lol/data/index.ts";
import { recordCoreOutputsDelivered } from "#src/analytics/guild-lifecycle.ts";
import { recordPoolMessageRefs } from "#src/betting/pool-open.ts";
import { refreshBucksMessages } from "#src/betting/message-refresh.ts";
import { startParlayGeneration } from "#src/betting/parlay-generate.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index.ts";
import type { BucksPrematchAttachment } from "#src/betting/prematch-hook.ts";
import type { LoadingScreenData } from "@scout-for-lol/data/index.ts";

export async function recordPrematchOutputs(input: {
  bucks: BucksPrematchAttachment;
  deliveredGuildIds: Set<DiscordGuildId>;
  gameInfo: RawCurrentGameInfo;
  loadingScreenData: LoadingScreenData | undefined;
  messageRefsByGuild: Map<string, { channelId: string; messageId: string }[]>;
  prematchContentBase: string;
  queueType: QueueType | undefined;
  trackedPlayers: PlayerConfigEntry[];
}): Promise<void> {
  for (const [serverId, refs] of input.messageRefsByGuild) {
    await recordPoolMessageRefs({
      matchId: input.bucks.matchId,
      serverId: DiscordGuildIdSchema.parse(serverId),
      refs,
      prematchContentBase: input.prematchContentBase,
    });
    await refreshBucksMessages({
      matchId: input.bucks.matchId,
      serverId: DiscordGuildIdSchema.parse(serverId),
    });
  }

  await recordCoreOutputsDelivered(input.deliveredGuildIds, "prematch");
  if (input.bucks.bettingGuildIds.size > 0) {
    await startParlayGeneration({
      gameInfo: input.gameInfo,
      trackedPlayers: input.trackedPlayers,
      queueType: input.queueType,
      loadingScreenData: input.loadingScreenData,
    });
  }
}
