import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import type { MessageCreateOptions } from "discord.js";
import {
  resolveQueueTypeFromGame,
  type DiscordGuildId,
  type LoadingScreenData,
} from "@scout-for-lol/data";
import { loadingScreenToImage } from "@scout-for-lol/report";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { NotificationTarget } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  bucksPrematchFurniture,
  type BucksPrematchAttachment,
} from "#src/betting/markets/prematch-hook.ts";
import { prematchBetsOpenForChannel } from "#src/temporal/v2/prematch/prematch-markets.ts";
import { clashSurfaceEnabledForPuuids } from "#src/league/clash/access.ts";
import { attachClashChrome } from "#src/league/clash/chrome.ts";
import {
  buildLoadingScreenData,
  fetchParticipantRanks,
} from "#src/league/tasks/prematch/loading-screen-builder.ts";
import { UnsupportedLoadingScreenQueueError } from "#src/league/tasks/prematch/loading-screen-errors.ts";
import {
  buildFallbackPrematchEmbed,
  buildPrematchPayload,
} from "#src/league/tasks/prematch/prematch-notification.ts";
import { formatPrematchMessage } from "#src/league/tasks/prematch/prematch-copy.ts";
import type { ScoutV2PrematchContext } from "#src/temporal/v2/prematch/prematch-context.ts";
import { resumeArchivedPrematchContext } from "#src/temporal/v2/prematch/prematch-resume.ts";
import type { ScoutV2AttestedPrematchArtifact } from "#src/temporal/v2/notification/notification-artifact.ts";

/**
 * The prematch-shaped notification: what a `prematch` intent renders and
 * delivers.
 *
 * A prematch intent announces a game that STARTED, and it is rendered from
 * the archived spectator snapshot — the canonical bytes the V2 prematch
 * capture wrote and receipted — never from a MatchV5 payload. That is the
 * whole point of keying the renderer on the intent's kind: by the time a
 * reconciliation sweep re-drives a stalled prematch intent the game may be
 * over and a MatchV5 payload may exist, and a renderer that reached for it
 * would deliver a post-match report where a game-start announcement was
 * promised, beside the post-match report the postmatch intent then delivers.
 * Nothing in this module can produce a post-match report, because nothing in
 * it reads one.
 *
 * ## What this keeps of v1, and what it leaves out
 *
 * The message is v1's: the same content line, the same loading screen, the
 * same fallback embed for a queue the loading screen cannot draw, and the
 * same Bryan Bucks buttons and live-market line, built by the same exported
 * v1 functions so the two paths cannot drift in wording.
 *
 * The buttons follow v1's rule stated against durable state. v1 opens a pool
 * per guild before its send and attaches buttons for each guild that got
 * one; here `openPrematchMarketsV2` opened the pools before any notification
 * child started, and the message to a channel carries buttons exactly when
 * that channel's guild holds an open pool. The other half of v1's contract —
 * recording which message carries the buttons, so the close sweep can grey
 * them out and the settlement announcement can find its bettors — happens
 * after delivery, in `prematch-follow-up.ts`.
 *
 * What it still leaves out is v1's feature tip (see `prematch-follow-up.ts`
 * for why), and v1's per-guild Clash partition: the Clash chrome is decided
 * once from the tracked players, as the render already was.
 *
 * ## The snapshot is fixed
 *
 * The capture already refused a partial lobby, so the loading screen is built
 * from a roster that is complete by construction and the "incomplete lobby"
 * retry v1 needs never arises here. What can still be true of the archived
 * game is that its queue has no loading screen at all, and that is a FACT
 * about the game — attested as `none` so the send knows to use the fallback
 * embed. Anything else that fails the render is thrown, and the Activity's
 * retry is the wait loop; a persistent asset failure then fails visibly
 * instead of quietly degrading every game to text.
 */

export type ScoutV2PrematchRender =
  | { readonly artifact: "image"; readonly image: Uint8Array }
  | { readonly artifact: "none"; readonly reason: "unsupported-queue" };

/** The snapshot this intent announces, or a broken contract. */
export async function requireArchivedPrematchContext(
  riotMatchId: RiotMatchId,
): Promise<ScoutV2PrematchContext> {
  const context = await resumeArchivedPrematchContext(riotMatchId);
  if (context === null) {
    throw new Error(
      `A prematch intent names ${riotMatchId} but no prematch snapshot was ever archived for it, so there is nothing to announce`,
    );
  }
  return context;
}

function regionOf(context: ScoutV2PrematchContext) {
  const first = context.trackedPlayers[0];
  if (first === undefined) {
    throw new Error(
      `The archived prematch snapshot for ${context.riotMatchId} names no tracked player, so no region can be resolved for it`,
    );
  }
  return first.league.leagueAccount.region;
}

/**
 * The loading screen's data for the archived game, with its Clash chrome.
 *
 * One builder for the render and for the parlay the post-delivery step
 * enqueues, so a parlay is generated from the same screen the channel saw —
 * v1 hands its parlay the primary presentation's data for the same reason.
 * Throws `UnsupportedLoadingScreenQueueError` for a queue with no screen.
 */
export async function buildPrematchLoadingScreenDataV2(
  context: ScoutV2PrematchContext,
): Promise<LoadingScreenData> {
  const region = regionOf(context);
  const trackedPuuids = new Set(
    context.trackedPlayers.map((player) => player.league.leagueAccount.puuid),
  );
  const ranks = await fetchParticipantRanks(context.gameInfo, region);
  return await attachClashChrome(
    await buildLoadingScreenData(
      context.gameInfo,
      trackedPuuids,
      region,
      ranks,
    ),
    await clashSurfaceEnabledForPuuids([...trackedPuuids]),
  );
}

/** The game-start line, before any Bryan Bucks digest is appended to it. */
async function prematchBaseContentV2(
  context: ScoutV2PrematchContext,
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
    await clashSurfaceEnabledForPuuids(
      context.trackedPlayers.map((player) => player.league.leagueAccount.puuid),
    ),
  );
}

/**
 * The non-betting content of the delivered message, as a pool stores it.
 *
 * v1's rule, unchanged: the loading-screen message's content is the
 * game-start line, and the fallback embed's message has no content of its
 * own, so its base is empty and the live-market line is the whole content.
 * The refresh that edits a pool's messages rebuilds their content from this.
 */
export async function prematchContentBaseV2(
  context: ScoutV2PrematchContext,
  artifact: ScoutV2AttestedPrematchArtifact["artifact"],
): Promise<string> {
  return artifact === "image" ? await prematchBaseContentV2(context) : "";
}

export async function renderPrematchNotificationV2(
  riotMatchId: RiotMatchId,
): Promise<ScoutV2PrematchRender> {
  const context = await requireArchivedPrematchContext(riotMatchId);
  let image: Uint8Array;
  try {
    image = await loadingScreenToImage(
      await buildPrematchLoadingScreenDataV2(context),
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

/**
 * The Bryan Bucks furniture for the message to one target.
 *
 * Buttons and the live-market line exactly when the target is a channel whose
 * guild holds an open pool for this match; nothing otherwise. The rows are
 * built only then, because `buildPrematchPayload` attaches whatever rows it
 * is given when `betsOpen` is true.
 */
async function prematchBucksFor(
  context: ScoutV2PrematchContext,
  target: NotificationTarget,
): Promise<{ betsOpen: boolean; bucks: BucksPrematchAttachment }> {
  const closed = {
    betsOpen: false,
    bucks: {
      bettingGuildIds: new Set<DiscordGuildId>(),
      rows: [],
      footer: "",
      matchId: context.riotMatchId,
    },
  };
  if (target.kind !== "channel") return closed;
  if (
    !(await prematchBetsOpenForChannel(context.riotMatchId, target.channelId))
  )
    return closed;
  return {
    betsOpen: true,
    bucks: {
      bettingGuildIds: new Set<DiscordGuildId>(),
      ...bucksPrematchFurniture({
        matchId: context.riotMatchId,
        gameInfo: context.gameInfo,
        trackedAliasByPuuid: new Map(
          context.trackedPlayers.map((player) => [
            player.league.leagueAccount.puuid,
            player.alias,
          ]),
        ),
      }),
      matchId: context.riotMatchId,
    },
  };
}

/**
 * The message a prematch intent delivers, built around the attested artifact.
 *
 * Content, loading screen and embed — or the fallback embed when the render
 * attested `none` — plus the Bryan Bucks buttons and live-market line when the
 * target's guild has an open pool for this game (see the module doc).
 */
export async function buildPrematchNotificationMessageV2(
  riotMatchId: RiotMatchId,
  artifact: ScoutV2AttestedPrematchArtifact,
  target: NotificationTarget,
): Promise<MessageCreateOptions> {
  const context = await requireArchivedPrematchContext(riotMatchId);
  const gameInfo = context.gameInfo;
  const [attachment, embed] =
    artifact.artifact === "image"
      ? loadingScreenAttachment(gameInfo.gameId.toString(), artifact.bytes)
      : [undefined, undefined];
  const { betsOpen, bucks } = await prematchBucksFor(context, target);
  return buildPrematchPayload({
    betsOpen,
    bucks,
    baseContent: await prematchBaseContentV2(context),
    loadingScreenAttachment: attachment,
    loadingScreenEmbed: embed,
    fallbackEmbed: () =>
      buildFallbackPrematchEmbed(gameInfo, context.trackedPlayers),
  });
}
