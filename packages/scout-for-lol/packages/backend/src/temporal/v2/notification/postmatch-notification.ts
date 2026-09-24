import { AttachmentBuilder, type MessageCreateOptions } from "discord.js";
import { ApplicationFailure } from "@temporalio/common";
import {
  MatchIdSchema,
  resolveQueueTypeFromGame,
  type MatchId,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { matchLinkComponents } from "#src/league/tasks/postmatch/match-report-components.ts";
import { withMvpVoteFurniture } from "#src/mvp-votes/components.ts";
import { emptyMvpTallyEmbed } from "#src/mvp-votes/tally.ts";
import { generateMatchReport } from "#src/league/tasks/postmatch/match-report-generator.ts";
import {
  AI_REVIEW_ATTACHMENT_NAME,
  aiReviewAttachment,
  attachReportImage,
  reportImageAttachmentName,
} from "#src/league/tasks/postmatch/match-report-image.ts";
import { resolvePostmatchDeliveryChannels } from "#src/league/tasks/notification-filters.ts";
import { resolveScoutV2ObservedMatchContext } from "#src/temporal/v2/match-context.ts";
import type { ScoutV2AttestedReportArtifact } from "#src/temporal/v2/notification/notification-artifact.ts";
import type { ScoutV2ReportComponentsSchema } from "#src/temporal/v2/notification-receipts.ts";
import type { z } from "zod";
import type { PostmatchRankChanges } from "#src/betting/dares/lifecycle/dare-rank-capture-v3.ts";

/**
 * The post-match report: what a `postmatch` intent renders and delivers.
 *
 * v1's generator does everything in one pass — it refetches every tracked
 * player's rank and writes this match's `MatchRankHistory`, decides whether
 * the game earns the one AI review a match is allowed and spends it, renders
 * the image, and assembles the message. Every one of those is a fact about
 * the MATCH that must be established once, and two of them are effects on
 * durable state: the rank upsert records the rank at the moment it ran, and
 * the review marks its attempt globally before the model is called. So the
 * generator runs exactly once per match, in the fenced render on the
 * background queue, and what it produced is attested in the render receipt:
 * the image, the review's image, the content line the review's text is part
 * of, and which components were attached.
 *
 * The delivery never calls the generator. It rebuilds the message from the
 * receipt and the verified bytes with the same furniture builders v1 uses —
 * `attachReportImage`, `aiReviewAttachment`, `matchLinkComponents` — so the
 * message every channel receives is the one the render attested, byte for
 * byte and word for word, and a delivery re-driven after the player's next
 * game rewrites no history and generates nothing. It also spends no Riot
 * read and no model call inside the single-attempt, thirty-second send.
 *
 * ## The audience the render evaluates
 *
 * The AI review is gated per guild, and v1 evaluates that gate against every
 * guild whose channel will receive the report, then sends the one message it
 * built to all of them. The render resolves the same audience through the
 * same derivation (`resolvePostmatchDeliveryChannels`) rather than through
 * the intent's own channel: the artifact is per match, every intent on the
 * match delivers it, and a review generated for one channel's guild and
 * withheld from the next would be exactly the per-channel drift v1 does not
 * have.
 *
 * ## Reaching into the message
 *
 * v1 renders and assembles in one step and has no seam for handing the parts
 * back, so this takes the built message apart rather than duplicating the
 * queue branching — Classic, Arena and Standard each render differently, and
 * a second copy of that decision would drift from the one v1 delivers. The
 * disassembly is strict: an attachment under a name this module does not
 * know, an embed the delivery would not rebuild, or components other than
 * the match link (and, on Flex, the MVP vote furniture) is a message the
 * receipt could not describe truthfully, and that is a broken contract with
 * v1's builders rather than a degraded mode.
 */

export type ScoutV2ReportComponents = z.infer<
  typeof ScoutV2ReportComponentsSchema
>;

export type ScoutV2PostmatchRender = {
  readonly image: Uint8Array;
  readonly review: Uint8Array | undefined;
  readonly content: string;
  readonly components: ScoutV2ReportComponents;
  /** The queue the report was rendered for, kept as object metadata. */
  readonly queueId: number;
  /** Riot's creation instant for the game, in epoch milliseconds. */
  readonly gameCreation: number;
};

/**
 * When, relative to the game, this report is being rendered.
 *
 * `live` is the ordinary render, minutes after the game: the generator
 * captures each tracked player's rank now, which IS the post-game rank, and
 * records it in `MatchRankHistory`.
 *
 * `historical` is a render long after the game — the silent post-match
 * backfill. The rank a player holds today is not the rank that game left
 * them at, and the generator's capture would upsert it over the row the
 * settlement-time capture already wrote for that game, rewriting history
 * that rank Dares and player profiles read. So a historical render is handed
 * the changes already recorded for the match and never captures one. A
 * player with no recorded row is rendered without a rank change rather than
 * with an invented one.
 *
 * A historical render also omits the community-MVP vote controls, and with
 * them the `MatchMvpContest` row they vote into: the report is never posted,
 * so a contest would have no message to be voted from and would sit in the
 * table as an orphan that anything counting contests reads as real. The
 * receipt then truthfully attests `match-link` rather than
 * `match-link-mvp-vote`. The AI review is kept.
 */
export type ScoutV2PostmatchRenderMode =
  | { readonly kind: "live" }
  | {
      readonly kind: "historical";
      readonly rankChanges: PostmatchRankChanges;
    };

function bufferedAttachment(file: unknown): {
  name: string;
  bytes: Uint8Array;
} {
  if (!(file instanceof AttachmentBuilder)) {
    throw new TypeError(
      "The report message carried an attachment that is not an AttachmentBuilder, which the render receipt cannot describe",
    );
  }
  const attachment: unknown = file.attachment;
  if (!(attachment instanceof Uint8Array)) {
    throw new TypeError(
      `The report message's attachment ${file.name ?? "(unnamed)"} is not buffered bytes, which the render cannot commit`,
    );
  }
  if (file.name === null) {
    throw new Error(
      "The report message carried an unnamed attachment, which the render receipt cannot describe",
    );
  }
  return { name: file.name, bytes: attachment };
}

function classifyComponents(
  message: MessageCreateOptions,
  matchId: MatchId,
): ScoutV2ReportComponents {
  const components = message.components ?? [];
  if (components.length === 0) return "none";
  if (
    JSON.stringify(components) === JSON.stringify(matchLinkComponents(matchId))
  ) {
    return "match-link";
  }
  const voteFurniture = withMvpVoteFurniture(
    { components: matchLinkComponents(matchId) },
    matchId,
  );
  if (JSON.stringify(components) === JSON.stringify(voteFurniture.components)) {
    return "match-link-mvp-vote";
  }
  throw new Error(
    `The report message for ${matchId} carries components other than the match link, which the render receipt cannot describe`,
  );
}

/** Take v1's built message apart into the parts the receipt attests. */
function disassembleReport(
  message: MessageCreateOptions,
  matchId: MatchId,
  game: { queueId: number; gameCreation: number },
): ScoutV2PostmatchRender {
  const content = message.content;
  if (content === undefined || content.length === 0) {
    throw new Error(
      `The report message for ${matchId} carries no content line, which every post-match report has`,
    );
  }
  let image: Uint8Array | undefined;
  let review: Uint8Array | undefined;
  for (const file of message.files ?? []) {
    const attachment = bufferedAttachment(file);
    if (attachment.name === reportImageAttachmentName(matchId)) {
      image = attachment.bytes;
    } else if (attachment.name === AI_REVIEW_ATTACHMENT_NAME) {
      review = attachment.bytes;
    } else {
      throw new Error(
        `The report message for ${matchId} carries an attachment named ${attachment.name}, which the render receipt cannot describe`,
      );
    }
  }
  if (image === undefined) {
    throw new Error(
      `The report message for ${matchId} carried no report image, so there is nothing to commit`,
    );
  }
  const components = classifyComponents(message, matchId);
  const [, expectedEmbed] = attachReportImage(image, matchId);
  const expectedEmbeds =
    components === "match-link-mvp-vote"
      ? [expectedEmbed, emptyMvpTallyEmbed()]
      : [expectedEmbed];
  if (JSON.stringify(message.embeds ?? []) !== JSON.stringify(expectedEmbeds)) {
    throw new Error(
      `The report message for ${matchId} carries embeds other than the report image's, which the delivery would not rebuild`,
    );
  }
  return {
    image,
    review,
    content,
    components,
    queueId: game.queueId,
    gameCreation: game.gameCreation,
  };
}

export async function renderPostmatchNotificationV2(
  riotMatchId: RiotMatchId,
  mode: ScoutV2PostmatchRenderMode,
): Promise<ScoutV2PostmatchRender> {
  // The OBSERVED roster, which is the one the minter used to decide this
  // report was owed. Rebuilding it here asked a different question and could
  // answer it differently for reasons outside the match: the live roster is
  // narrowed by the Discord gateway's guild cache, and this Activity runs on
  // the `background` queue while the mint runs on `realtime`, so the two are
  // different worker pools. An empty rebuild produced no report at all, after
  // the cursor had already advanced past the match.
  //
  // The subscription lookup below still asks who subscribes NOW, which is
  // right — a channel that unsubscribed should not receive this. It is only
  // the PUUIDs it is keyed by that belong to the past.
  const context = await resolveScoutV2ObservedMatchContext(riotMatchId);
  const audience = await resolvePostmatchDeliveryChannels({
    puuids: context.trackedPlayers.map(
      (player) => player.league.leagueAccount.puuid,
    ),
    queueType: resolveQueueTypeFromGame(
      context.matchData.info.queueId,
      context.matchData.info.gameMode,
      context.matchData.info.gameType,
    ),
  });
  const message = await generateMatchReport(
    context.matchData,
    context.trackedPlayers,
    {
      targetGuildIds: audience.guildIds,
      ...(mode.kind === "historical"
        ? { prefetchedRankChanges: mode.rankChanges, omitMvpVotes: true }
        : {}),
    },
  );
  if (message === undefined) {
    // The report generator found no tracked player it could render. An intent
    // exists for this match, so that is a disagreement between the producer
    // that minted it and the renderer, and no retry resolves it.
    throw ApplicationFailure.nonRetryable(
      `No report could be rendered for ${riotMatchId} despite an intent naming it`,
      "MissingDomainRecord",
    );
  }
  return disassembleReport(message, context.matchId, {
    queueId: context.matchData.info.queueId,
    gameCreation: context.matchData.info.gameCreation,
  });
}

/**
 * The message a postmatch intent delivers, rebuilt from what the render
 * attested. Pure over its inputs: nothing here reads a payload, a rank, a
 * flag or a model.
 */
export function buildPostmatchNotificationMessageV2(
  riotMatchId: RiotMatchId,
  artifact: ScoutV2AttestedReportArtifact,
): MessageCreateOptions {
  const matchId = MatchIdSchema.parse(riotMatchId);
  const [attachment, embed] = attachReportImage(artifact.image, matchId);
  const files = [attachment];
  if (artifact.review !== undefined) {
    files.push(aiReviewAttachment(artifact.review));
  }
  const message: MessageCreateOptions = {
    content: artifact.evidence.content,
    files,
    embeds: [embed],
  };
  switch (artifact.evidence.components) {
    case "match-link":
      return { ...message, components: matchLinkComponents(matchId) };
    case "match-link-mvp-vote":
      return withMvpVoteFurniture(
        { ...message, components: matchLinkComponents(matchId) },
        matchId,
      );
    case "none":
      return message;
  }
}
