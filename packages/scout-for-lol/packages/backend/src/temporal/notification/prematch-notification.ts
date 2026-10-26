import { clashSurfaceEnabledForPuuids } from "#src/league/clash/access.ts";
import { attachClashChrome } from "#src/league/clash/chrome.ts";
import { readClientObservedBots } from "#src/league/tasks/prematch/client-bot-roster.ts";
import {
  buildLoadingScreenData,
  fetchParticipantRanks,
} from "#src/league/tasks/prematch/loading-screen-builder.ts";
import { UnsupportedLoadingScreenQueueError } from "#src/league/tasks/prematch/loading-screen-errors.ts";
import { formatPrematchMessage } from "#src/league/tasks/prematch/prematch-copy.ts";
import {
  buildFallbackPrematchEmbed,
  buildPrematchPayload,
} from "#src/league/tasks/prematch/prematch-notification.ts";
import type { ScoutAttestedPrematchArtifact } from "#src/temporal/notification/notification-artifact.ts";
import type { ScoutPrematchContext } from "#src/temporal/prematch/prematch-context.ts";
import { resumeArchivedPrematchContext } from "#src/temporal/prematch/prematch-resume.ts";
import {
  resolveQueueTypeFromGame,
  type LoadingScreenData,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { NotificationTarget } from "@scout-for-lol/domain/notifications/intent.ts";
import { loadingScreenToImage } from "@scout-for-lol/report";
import type { MessageCreateOptions } from "discord.js";
import { AttachmentBuilder, EmbedBuilder } from "discord.js";

export type ScoutPrematchRender =
  | { readonly artifact: "image"; readonly image: Uint8Array }
  | { readonly artifact: "none"; readonly reason: "unsupported-queue" };

/** The snapshot this intent announces, or a broken contract. */
export async function requireArchivedPrematchContext(
  riotMatchId: RiotMatchId,
): Promise<ScoutPrematchContext> {
  const context = await resumeArchivedPrematchContext(riotMatchId);
  if (context === null) {
    throw new Error(
      `A prematch intent names ${riotMatchId} but no prematch snapshot was ever archived for it, so there is nothing to announce`,
    );
  }
  return context;
}

function regionOf(context: ScoutPrematchContext) {
  const first = context.trackedPlayers[0];
  if (first === undefined) {
    throw new Error(
      `The archived prematch snapshot for ${context.riotMatchId} names no tracked player, so no region can be resolved for it`,
    );
  }
  return first.league.leagueAccount.region;
}

export async function buildPrematchLoadingScreenData(
  context: ScoutPrematchContext,
  clashEnabled?: boolean,
): Promise<LoadingScreenData> {
  const region = regionOf(context);
  const trackedPuuids = new Set(
    context.trackedPlayers.map((player) => player.league.leagueAccount.puuid),
  );
  const [ranks, observedBots] = await Promise.all([
    fetchParticipantRanks(context.gameInfo, region),
    // Riot omits bots from the Spectator roster, so a bot custom renders as a
    // near-empty lobby unless the local client's own view of it is folded in.
    readClientObservedBots(context.gameInfo.gameId.toString(), trackedPuuids),
  ]);
  return await attachClashChrome(
    await buildLoadingScreenData(context.gameInfo, trackedPuuids, region, {
      prefetchedRanks: ranks,
      observedBots,
    }),
    clashEnabled ?? (await clashSurfaceEnabledForPuuids([...trackedPuuids])),
  );
}

async function prematchBaseContent(
  context: ScoutPrematchContext,
  clashEnabled?: boolean,
): Promise<string> {
  const gameInfo = context.gameInfo;
  return formatPrematchMessage(
    context.trackedPlayers,
    resolveQueueTypeFromGame(
      gameInfo.gameQueueConfigId,
      gameInfo.gameMode,
      gameInfo.gameType,
    ),
    gameInfo.gameMode,
    clashEnabled ??
      (await clashSurfaceEnabledForPuuids(
        context.trackedPlayers.map(
          (player) => player.league.leagueAccount.puuid,
        ),
      )),
  );
}

export async function resolvePrematchContentBase(
  context: ScoutPrematchContext,
  artifact: ScoutAttestedPrematchArtifact["artifact"],
  clashEnabled?: boolean,
): Promise<string> {
  return artifact === "image"
    ? await prematchBaseContent(context, clashEnabled)
    : "";
}

export async function renderPrematchNotification(
  riotMatchId: RiotMatchId,
  clashEnabled?: boolean,
): Promise<ScoutPrematchRender> {
  const context = await requireArchivedPrematchContext(riotMatchId);
  let image: Uint8Array;
  try {
    image = await loadingScreenToImage(
      await buildPrematchLoadingScreenData(context, clashEnabled),
    );
  } catch (error) {
    if (error instanceof UnsupportedLoadingScreenQueueError) {
      return { artifact: "none", reason: "unsupported-queue" };
    }
    throw error;
  }
  return { artifact: "image", image };
}

function loadingScreenAttachment(
  gameId: string,
  image: Uint8Array,
): [AttachmentBuilder, EmbedBuilder] {
  const attachmentName = `loading-screen-${gameId}.png`;
  return [
    new AttachmentBuilder(Buffer.from(image)).setName(attachmentName),
    new EmbedBuilder({ image: { url: `attachment://${attachmentName}` } }),
  ];
}

export async function buildPrematchNotificationMessage(
  riotMatchId: RiotMatchId,
  artifact: ScoutAttestedPrematchArtifact,
  _target: NotificationTarget,
  clashEnabled?: boolean,
): Promise<MessageCreateOptions> {
  const context = await requireArchivedPrematchContext(riotMatchId);
  const gameInfo = context.gameInfo;
  const [attachment, embed] =
    artifact.artifact === "image"
      ? loadingScreenAttachment(gameInfo.gameId.toString(), artifact.bytes)
      : [undefined, undefined];
  return buildPrematchPayload({
    baseContent: await prematchBaseContent(context, clashEnabled),
    loadingScreenAttachment: attachment,
    loadingScreenEmbed: embed,
    fallbackEmbed: () =>
      buildFallbackPrematchEmbed(gameInfo, context.trackedPlayers),
  });
}
