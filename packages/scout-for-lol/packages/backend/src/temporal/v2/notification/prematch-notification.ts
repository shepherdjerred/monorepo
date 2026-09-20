import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import type { MessageCreateOptions } from "discord.js";
import { resolveQueueTypeFromGame } from "@scout-for-lol/data";
import { loadingScreenToImage } from "@scout-for-lol/report";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
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
 * same fallback embed for a queue the loading screen cannot draw, built by
 * the same exported v1 functions so the two paths cannot drift in wording.
 * What it does NOT do is open Bryan Bucks markets or attach their buttons:
 * v1 opens a pool per guild during its send and records the message
 * references afterwards so the pool's message can be refreshed when betting
 * closes, and half of that — buttons on a message nothing recorded — would be
 * a market a user can see and the bot cannot later close. The V2 prematch
 * send therefore carries no markets, and Bucks on the V2 prematch path is an
 * explicit gap rather than a silent one.
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
async function requireArchivedPrematchContext(
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

export async function renderPrematchNotificationV2(
  riotMatchId: RiotMatchId,
): Promise<ScoutV2PrematchRender> {
  const context = await requireArchivedPrematchContext(riotMatchId);
  const region = regionOf(context);
  const trackedPuuids = new Set(
    context.trackedPlayers.map((player) => player.league.leagueAccount.puuid),
  );
  let image: Uint8Array;
  try {
    const ranks = await fetchParticipantRanks(context.gameInfo, region);
    const data = await attachClashChrome(
      await buildLoadingScreenData(
        context.gameInfo,
        trackedPuuids,
        region,
        ranks,
      ),
      await clashSurfaceEnabledForPuuids([...trackedPuuids]),
    );
    image = await loadingScreenToImage(data);
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
 * The message a prematch intent delivers, built around the attested artifact.
 *
 * `betsOpen` is false and the Bucks attachment empty by design — see the
 * module doc — so the payload is content, loading screen and embed, or the
 * fallback embed when the render attested `none`.
 */
export async function buildPrematchNotificationMessageV2(
  riotMatchId: RiotMatchId,
  artifact: ScoutV2AttestedPrematchArtifact,
): Promise<MessageCreateOptions> {
  const context = await requireArchivedPrematchContext(riotMatchId);
  const gameInfo = context.gameInfo;
  const queueType = resolveQueueTypeFromGame(
    gameInfo.gameQueueConfigId,
    gameInfo.gameMode,
    gameInfo.gameType,
  );
  const [attachment, embed] =
    artifact.artifact === "image"
      ? loadingScreenAttachment(gameInfo.gameId.toString(), artifact.bytes)
      : [undefined, undefined];
  return buildPrematchPayload({
    betsOpen: false,
    bucks: {
      bettingGuildIds: new Set(),
      rows: [],
      footer: "",
      matchId: riotMatchId,
    },
    baseContent: formatPrematchMessage(
      context.trackedPlayers,
      queueType,
      gameInfo.gameMode,
      await clashSurfaceEnabledForPuuids(
        context.trackedPlayers.map(
          (player) => player.league.leagueAccount.puuid,
        ),
      ),
    ),
    loadingScreenAttachment: attachment,
    loadingScreenEmbed: embed,
    fallbackEmbed: () =>
      buildFallbackPrematchEmbed(gameInfo, context.trackedPlayers),
  });
}
