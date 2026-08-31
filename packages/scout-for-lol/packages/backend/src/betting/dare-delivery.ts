import * as Sentry from "@sentry/bun";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  defaultDareDiscordDependencies,
  refreshDareCallout,
  type DareDiscordDependencies,
} from "#src/betting/dare-callout.ts";
import { dareResultMessage } from "#src/betting/dare-copy.ts";
import type { DareSettlementSummary } from "#src/betting/dare-settle.ts";
import { observeBucksDelivery } from "#src/betting/delivery-observability.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-dare-delivery");

/**
 * Deliver domain-produced dare settlement summaries to Discord.
 *
 * Called by the sweep tasks and the post-match pipeline AFTER their
 * transactions committed. `captured` only refreshes the callout's progress;
 * `abandoned` is silent (nothing public ever existed); every other resolution
 * gets ONE result message with restricted mentions plus a best-effort final
 * edit of the callout with its components removed. Each summary sits in its
 * own try/catch so a dead channel cannot swallow the rest (announce.ts
 * precedent), and nothing here ever throws to the caller — a delivery
 * failure never blocks the ingest cursor or rolls back a settlement.
 */
export async function deliverDareSummaries(
  summaries: readonly DareSettlementSummary[],
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  if (summaries.length === 0) {
    return;
  }
  const deps: DareDiscordDependencies = {
    ...defaultDareDiscordDependencies,
    prismaClient,
  };
  for (const summary of summaries) {
    try {
      if (summary.resolution === "abandoned") {
        continue;
      }
      const message = dareResultMessage(summary);
      if (message !== undefined) {
        await observeBucksDelivery(
          {
            surface: "dare_result",
            operation: "send",
            serverId: summary.serverId,
            channelId: summary.channelId,
            ...(summary.matchId === undefined
              ? {}
              : { matchId: summary.matchId }),
          },
          () =>
            deps.sendMessage(
              {
                content: message.content,
                allowedMentions: { parse: [], users: message.mentionUserIds },
              },
              DiscordChannelIdSchema.parse(summary.channelId),
              DiscordGuildIdSchema.parse(summary.serverId),
            ),
        );
      }
      // Progress for a capture; final content with components removed for a
      // resolution — both read back from the database, never from the summary.
      // A summary with no recorded callout ref skips the refresh outright:
      // refreshDareCallout would reload full state only to early-return, and
      // the ref is written once at confirm time so it cannot appear later.
      if (summary.messageRef !== null) {
        await refreshDareCallout(summary.dareId, deps);
      }
    } catch (error) {
      logger.error(
        `❌ Could not deliver the result of dare ${summary.dareId.toString()}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "betting-dare-delivery",
          dareId: summary.dareId.toString(),
        },
      });
    }
  }
}
