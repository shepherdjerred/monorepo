import type { PostmatchRankChanges } from "#src/dares/lifecycle/dare-rank-capture.ts";
import { prisma } from "#src/database/index.ts";
import { getAccountConfigsByPuuids } from "#src/database/player-accounts.ts";
import { readReportScoreboard } from "#src/evidence/report-scoreboard.ts";
import { resolvePostmatchDeliveryChannels } from "#src/league/tasks/notification-filters.ts";
import {
  inlineMatchLink,
  matchLinkComponents,
} from "#src/league/tasks/postmatch/match-report-components.ts";
import {
  formatGameCompletionMessage,
  generateMatchReport,
} from "#src/league/tasks/postmatch/match-report-generator.ts";
import {
  attachReportImage,
  createMatchImage,
  reportImageAttachmentName,
} from "#src/league/tasks/postmatch/match-report-image.ts";
import { buildScoreboardReport } from "#src/league/tasks/postmatch/scoreboard-report.ts";
import { withMvpVoteFurniture } from "#src/mvp-votes/components.ts";
import { emptyMvpTallyEmbed } from "#src/mvp-votes/tally.ts";
import { resolveScoutObservedMatchContext } from "#src/temporal/match/match-context.ts";
import type { ScoutReportComponentsSchema } from "#src/temporal/notification-lane/notification-receipts.ts";
import type { ScoutAttestedReportArtifact } from "#src/temporal/notification/notification-artifact.ts";
import { resolveQueueTypeFromGame } from "@scout-for-lol/data";
import { gameResultTimestamp } from "@scout-for-lol/domain/artifacts/game-result.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { ApplicationFailure } from "@temporalio/common";
import { AttachmentBuilder, type MessageCreateOptions } from "discord.js";
import type { z } from "zod";

/**
 * The post-match renderer captures ranks once and commits the report image,
 * content and components. Delivery rebuilds that frozen message without
 * refetching ranks or rendering again.
 */
export type ScoutReportComponents = z.infer<typeof ScoutReportComponentsSchema>;

export type ScoutPostmatchRender = {
  readonly image: Uint8Array;
  readonly content: string;
  readonly components: ScoutReportComponents;
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
 * receipt then truthfully attests `inline-match-link` rather than
 * `inline-match-link-mvp-vote`.
 */
export type ScoutPostmatchRenderMode =
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
  matchId: RiotMatchId,
): ScoutReportComponents {
  const components = message.components ?? [];
  const hasInlineLink =
    typeof message.content === "string" &&
    message.content.endsWith(`\n\n${inlineMatchLink(matchId)}`);
  if (components.length === 0) {
    return hasInlineLink ? "inline-match-link" : "none";
  }
  if (
    JSON.stringify(components) === JSON.stringify(matchLinkComponents(matchId))
  ) {
    return "match-link";
  }
  const legacyVoteFurniture = withMvpVoteFurniture(
    { components: matchLinkComponents(matchId) },
    matchId,
  );
  if (
    JSON.stringify(components) ===
    JSON.stringify(legacyVoteFurniture.components)
  ) {
    return "match-link-mvp-vote";
  }
  const inlineVoteFurniture = withMvpVoteFurniture({ components: [] }, matchId);
  if (
    hasInlineLink &&
    JSON.stringify(components) ===
      JSON.stringify(inlineVoteFurniture.components)
  ) {
    return "inline-match-link-mvp-vote";
  }
  throw new Error(
    `The report message for ${matchId} carries unsupported match-link or MVP components, which the render receipt cannot describe`,
  );
}

/** Take v1's built message apart into the parts the receipt attests. */
function disassembleReport(
  message: MessageCreateOptions,
  matchId: RiotMatchId,
  game: { queueId: number; gameCreation: number },
): ScoutPostmatchRender {
  const content = message.content;
  if (content === undefined || content.length === 0) {
    throw new Error(
      `The report message for ${matchId} carries no content line, which every post-match report has`,
    );
  }
  let image: Uint8Array | undefined;
  for (const file of message.files ?? []) {
    const attachment = bufferedAttachment(file);
    if (attachment.name === reportImageAttachmentName(matchId)) {
      image = attachment.bytes;
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
    components === "inline-match-link-mvp-vote" ||
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
    content,
    components,
    queueId: game.queueId,
    gameCreation: game.gameCreation,
  };
}

export async function renderPostmatchNotification(
  riotMatchId: RiotMatchId,
  mode: ScoutPostmatchRenderMode,
): Promise<ScoutPostmatchRender> {
  const scoreboard = await readReportScoreboard(riotMatchId);
  if (scoreboard !== null) {
    const players = await getAccountConfigsByPuuids(
      scoreboard.trackedPuuids,
      prisma,
    );
    const report = buildScoreboardReport(scoreboard.result, players);
    if (report === null)
      throw new Error(
        `Frozen report evidence is not renderable for ${riotMatchId}`,
      );
    const [attachment, embed] = await createMatchImage(
      report,
      riotMatchId,
      undefined,
    );
    return disassembleReport(
      {
        content: formatGameCompletionMessage(
          report.players.map((player) => player.playerConfig.alias),
          report.queueType,
        ),
        files: [attachment],
        embeds: [embed],
      },
      riotMatchId,
      {
        queueId: scoreboard.result.queueId,
        gameCreation: gameResultTimestamp(scoreboard.result),
      },
    );
  }
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
  const context = await resolveScoutObservedMatchContext(riotMatchId);
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
  return disassembleReport(message, context.riotMatchId, {
    queueId: context.matchData.info.queueId,
    gameCreation: context.matchData.info.gameCreation,
  });
}

/**
 * The message a postmatch intent delivers, rebuilt from what the render
 * attested. Pure over its inputs: nothing here reads a payload, a rank, a
 * flag or a model.
 */
export function buildPostmatchNotificationMessage(
  riotMatchId: RiotMatchId,
  artifact: ScoutAttestedReportArtifact,
): MessageCreateOptions {
  const matchId = riotMatchId;
  const [attachment, embed] = attachReportImage(artifact.image, matchId);
  const files = [attachment];
  const message: MessageCreateOptions = {
    content: artifact.evidence.content,
    files,
    embeds: [embed],
  };
  switch (artifact.evidence.components) {
    case "inline-match-link":
      return message;
    case "inline-match-link-mvp-vote":
      return withMvpVoteFurniture(message, matchId);
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
