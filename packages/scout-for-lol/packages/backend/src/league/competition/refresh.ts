import {
  type CachedLeaderboard,
  type CompetitionWithCriteria,
  getCompetitionStatus,
} from "@scout-for-lol/data/index.ts";
import { AttachmentBuilder } from "discord.js";
import * as Sentry from "@sentry/bun";
import { prisma } from "#src/database/index.ts";
import {
  calculateLeaderboard,
  type RankedLeaderboardEntry,
} from "#src/league/competition/leaderboard.ts";
import { renderCompetitionChartBuffer } from "#src/league/competition/chart-builder.ts";
import { saveCachedLeaderboard } from "#src/storage/s3-leaderboard.ts";
import { saveLeaderboardImage } from "#src/storage/s3-leaderboard-image.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("competition-refresh");

/**
 * Persist a freshly-computed leaderboard to S3: the standings JSON
 * (`current.json` + dated snapshot) and the rendered chart PNG
 * (`current.png` + dated snapshot). Every artifact is best-effort — a cache
 * or render failure is logged and swallowed so it never blocks the caller's
 * own work (the daily Discord post, or the web mutation response).
 *
 * Returns the rendered chart as a Discord attachment (or `null`) so the daily
 * update can forward it to Discord without rendering twice.
 */
export async function cacheLeaderboardArtifacts(params: {
  competition: CompetitionWithCriteria;
  entries: RankedLeaderboardEntry[];
  calculatedAt: Date;
}): Promise<{ chartAttachment: AttachmentBuilder | null }> {
  const { competition, entries, calculatedAt } = params;

  const cachedLeaderboard: CachedLeaderboard = {
    version: "v1",
    competitionId: competition.id,
    calculatedAt: calculatedAt.toISOString(),
    entries,
  };

  try {
    await saveCachedLeaderboard(cachedLeaderboard);
  } catch (error) {
    logger.error(
      `[Refresh] ⚠️  Failed to cache leaderboard JSON for competition ${competition.id.toString()}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: {
        source: "refresh-cache-leaderboard-json",
        competitionId: competition.id.toString(),
      },
    });
  }

  let chartAttachment: AttachmentBuilder | null = null;
  try {
    const rendered = await renderCompetitionChartBuffer(competition, entries);
    if (rendered !== null) {
      await saveLeaderboardImage(competition.id, calculatedAt, rendered.data);
      chartAttachment = new AttachmentBuilder(rendered.data, {
        name: `competition-${competition.id.toString()}-${rendered.chartType === "bar" ? "standings" : "trend"}.png`,
      });
    }
  } catch (error) {
    logger.error(
      `[Refresh] ⚠️  Failed to render/cache leaderboard chart for competition ${competition.id.toString()}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: {
        source: "refresh-cache-leaderboard-image",
        competitionId: competition.id.toString(),
      },
    });
  }

  return { chartAttachment };
}

/**
 * Recompute a competition's leaderboard and persist all artifacts to S3.
 *
 * Used by the web "Refresh standings" mutation. The heavy lifting
 * ({@link calculateLeaderboard}) hits the Riot API + S3 match store, so this
 * is an explicit, user-triggered action — never a hot path.
 *
 * @throws if the competition is not ACTIVE (DRAFT has no leaderboard;
 *   ENDED/CANCELLED standings are frozen). Callers should surface this as a
 *   user-facing error.
 */
export async function refreshAndCacheLeaderboard(
  competition: CompetitionWithCriteria,
): Promise<RankedLeaderboardEntry[]> {
  const status = getCompetitionStatus(competition);
  if (status !== "ACTIVE") {
    throw new Error(
      `Cannot refresh standings for a ${status} competition — only ACTIVE competitions recompute.`,
    );
  }

  const entries = await calculateLeaderboard(prisma, competition);
  await cacheLeaderboardArtifacts({
    competition,
    entries,
    calculatedAt: new Date(),
  });
  return entries;
}
