import * as Sentry from "@sentry/bun";
import {
  BucksPoolRosterSchema,
  BucksPredictionSchema,
  LeaguePuuidSchema,
  type BucksPoolParticipant,
  type BucksPrediction,
  type DiscordGuildId,
  type QueueType,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data";
import { BETTING_WINDOW_MS } from "#src/betting/constants.ts";
import { isBettableGame } from "#src/betting/eligibility.ts";
import { isUniqueConstraintError } from "#src/lib/player-admin/shared.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  bettingMessageRefsRecordedTotal,
  bettingPoolOpenFailuresTotal,
  bettingPoolsOpenedTotal,
} from "#src/metrics/betting.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";

/** Prometheus label values must be bounded; a queue with spaces is normalised. */
function metricQueueType(queueType: string | undefined): string {
  return (queueType ?? "unknown").replaceAll(" ", "_");
}

const logger = createLogger("betting-pool-open");

/**
 * Opening a betting market when Scout notices a game.
 *
 * Every failure here is swallowed and reported. A market is a bonus on top of
 * the prematch notification, which is core product output — a betting bug must
 * never stop the loading screen from being posted.
 */

/**
 * When betting closes.
 *
 * `detectedAt` is when *Scout* noticed, which can be up to 30 seconds after the
 * game appeared, and the spectator API surfaces games during the pre-game
 * countdown. Taking the earlier of "ten minutes from detection" and "ten
 * minutes from the game's own start" keeps a late detection from silently
 * handing bettors extra time to watch the game develop.
 *
 * `gameStartTime` is 0 while the lobby is still in countdown, in which case
 * there is nothing to clamp against.
 */
export function computeClosesAt(input: {
  detectedAt: Date;
  gameStartTime: number;
}): Date {
  const fromDetection = input.detectedAt.getTime() + BETTING_WINDOW_MS;
  if (input.gameStartTime <= 0) {
    return new Date(fromDetection);
  }
  return new Date(
    Math.min(fromDetection, input.gameStartTime + BETTING_WINDOW_MS),
  );
}

/** Resolve the game's start even while Spectator reports a zero timestamp.
 * `gameLength` is elapsed seconds and is negative during countdown. */
export function computeGameStartAt(input: {
  detectedAt: Date;
  gameStartTime: number;
  gameLength: number;
}): Date {
  if (input.gameStartTime > 0) {
    return new Date(input.gameStartTime);
  }
  return new Date(input.detectedAt.getTime() - input.gameLength * 1000);
}

function buildRoster(input: {
  gameInfo: RawCurrentGameInfo;
  trackedAliasByPuuid: ReadonlyMap<string, string>;
}): BucksPoolParticipant[] {
  return input.gameInfo.participants.map((participant) => {
    const puuid =
      participant.puuid === null
        ? null
        : LeaguePuuidSchema.parse(participant.puuid);
    const alias =
      participant.puuid === null
        ? undefined
        : input.trackedAliasByPuuid.get(participant.puuid);
    return {
      puuid,
      teamId: participant.teamId === 100 ? 100 : 200,
      championId: participant.championId,
      riotId: participant.riotId,
      trackedAlias: alias,
    };
  });
}

/**
 * The subset of guilds a game would open a market in.
 *
 * Prediction capture is intentionally independent of this flag so every
 * eligible detected game can contribute a match-scoped v2 observation. This
 * helper remains the authoritative gate for the guild-scoped wallet, pool,
 * and button surfaces.
 */
export async function bettingEnabledGuilds(
  guildIds: readonly DiscordGuildId[],
): Promise<DiscordGuildId[]> {
  const enabled: DiscordGuildId[] = [];
  for (const serverId of guildIds) {
    if (await isPolicyEnabled("betting_enabled", { server: serverId })) {
      enabled.push(serverId);
    }
  }
  return enabled;
}

export type OpenPoolsInput = {
  matchId: string;
  gameInfo: RawCurrentGameInfo;
  queueType: QueueType | undefined;
  guildIds: readonly DiscordGuildId[];
  detectedAt: Date;
  /** puuid -> alias, for the tracked players in this game. */
  trackedAliasByPuuid: ReadonlyMap<string, string>;
  prediction?: BucksPrediction | undefined;
};

/**
 * Create a pool per flag-enabled guild that this game is being announced in.
 *
 * @returns the guilds that got a pool, so the caller knows where to attach
 * betting buttons
 */
export async function openBettingPoolsForPrematch(
  input: OpenPoolsInput,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<Set<DiscordGuildId>> {
  const opened = new Set<DiscordGuildId>();

  try {
    if (
      !isBettableGame({
        queueType: input.queueType,
        participants: input.gameInfo.participants,
      })
    ) {
      return opened;
    }

    const enabledGuilds = await bettingEnabledGuilds(input.guildIds);
    if (enabledGuilds.length === 0) {
      return opened;
    }

    const roster = BucksPoolRosterSchema.parse({
      participants: buildRoster({
        gameInfo: input.gameInfo,
        trackedAliasByPuuid: input.trackedAliasByPuuid,
      }),
    });
    const closesAt = computeClosesAt({
      detectedAt: input.detectedAt,
      gameStartTime: input.gameInfo.gameStartTime,
    });
    const predictionJson =
      input.prediction === undefined
        ? null
        : JSON.stringify(BucksPredictionSchema.parse(input.prediction));

    for (const serverId of enabledGuilds) {
      // Create rather than upsert: the prematch poll can re-detect the same
      // game before the notification lands, and a re-detection must neither
      // extend a live window nor reopen a settled pool. `upsert`'s update
      // branch already did nothing for that case, so a plain `create` with
      // its unique-constraint violation caught is behaviourally identical —
      // and, unlike upsert, unambiguous about whether a pool was actually
      // opened. The metric and transition log must only fire on that create
      // branch, or a re-detection reads as repeated opens.
      let created = true;
      try {
        await prismaClient.bucksMatchPool.create({
          data: {
            matchId: input.matchId,
            serverId,
            detectedAt: input.detectedAt,
            closesAt,
            queueType: input.queueType ?? null,
            roster: JSON.stringify(roster),
            predictionJson,
          },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
        created = false;
      }
      opened.add(serverId);
      if (!created) {
        continue;
      }
      // Post-commit: the create above has already resolved.
      bettingPoolsOpenedTotal.inc({
        queue_type: metricQueueType(input.queueType),
      });
      logBucksTransition({
        event: "bucks.pool.opened",
        matchId: input.matchId,
        serverId,
        toState: "open",
        queueType: input.queueType ?? "unknown",
        surface: "prematch",
      });
    }

    logger.info(
      `🎲 Opened ${opened.size.toString()} Bryan Bucks pool(s) for ${input.matchId}`,
    );
  } catch (error) {
    logger.error(
      `❌ Could not open Bryan Bucks pools for ${input.matchId}:`,
      error,
    );
    bettingPoolOpenFailuresTotal.inc();
    Sentry.captureException(error, {
      tags: { source: "betting-pool-open", matchId: input.matchId },
    });
    return new Set<DiscordGuildId>();
  }

  return opened;
}

const MESSAGE_REF_ATTEMPTS = 3;
const MESSAGE_REF_BACKOFF_MS = 250;

/**
 * Record which message carries this guild's buttons.
 *
 * Two things read this back, and only one of them is cosmetic. The close sweep
 * uses it to grey out exactly the right buttons, which closure at bet time
 * against `closesAt` already enforces anyway — but `announceSettlements` also
 * uses it as the *only* record of where a pool's bettors are watching. Losing
 * the write therefore costs the settlement message, and that summary is
 * one-shot: `settleBettingForMatch` returns nothing for an already-settled
 * pool, so nothing later can notice the omission and re-send.
 *
 * Hence a bounded retry and an error-level report rather than a shrug. It still
 * must not throw: this runs inside prematch delivery, where a betting failure
 * may not take the loading screen down with it.
 */
export async function recordPoolMessageRefs(
  input: {
    matchId: string;
    serverId: DiscordGuildId;
    refs: readonly { channelId: string; messageId: string }[];
    prematchContentBase: string;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  for (let attempt = 1; attempt <= MESSAGE_REF_ATTEMPTS; attempt++) {
    try {
      await prismaClient.bucksMatchPool.update({
        where: {
          matchId_serverId: {
            matchId: input.matchId,
            serverId: input.serverId,
          },
        },
        data: {
          messageRefs: JSON.stringify(input.refs),
          prematchContentBase: input.prematchContentBase,
        },
      });
      bettingMessageRefsRecordedTotal.inc({ status: "recorded" });
      return;
    } catch (error) {
      if (attempt < MESSAGE_REF_ATTEMPTS) {
        const delayMs = MESSAGE_REF_BACKOFF_MS * 2 ** (attempt - 1);
        logger.warn(
          `⚠️ Attempt ${attempt.toString()}/${MESSAGE_REF_ATTEMPTS.toString()} to record Bryan Bucks message refs for ${input.matchId} in guild ${input.serverId} failed; retrying in ${delayMs.toString()}ms:`,
          error,
        );
        await Bun.sleep(delayMs);
        continue;
      }
      logger.error(
        `❌ Could not record Bryan Bucks message refs for ${input.matchId} in guild ${input.serverId} — this pool's settlement announcement now has nowhere to go:`,
        error,
      );
      bettingMessageRefsRecordedTotal.inc({ status: "failed" });
      Sentry.captureException(error, {
        tags: {
          source: "betting-record-message-refs",
          matchId: input.matchId,
          serverId: input.serverId,
        },
      });
    }
  }
}
