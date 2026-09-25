import * as Sentry from "@sentry/bun";
import {
  BucksMessageRefsSchema,
  BucksPoolRosterSchema,
  LeaguePuuidSchema,
  type BucksMessageRef,
  type BucksPoolParticipant,
  type DiscordGuildId,
  type QueueType,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data";
import { BETTING_WINDOW_MS } from "#src/betting/constants.ts";
import { isBettableGame } from "#src/betting/eligibility/eligibility.ts";
import { isUniqueConstraintError } from "#src/lib/player-admin/shared.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  bettingMessageRefsRecordedTotal,
  bettingPoolOpenFailuresTotal,
  bettingPoolsOpenedTotal,
} from "#src/metrics/betting/betting.ts";
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
  return input.gameStartTime <= 0
    ? new Date(fromDetection)
    : new Date(
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
  return input.gameStartTime > 0
    ? new Date(input.gameStartTime)
    : new Date(input.detectedAt.getTime() - input.gameLength * 1000);
}

// Peek is retired and this value is never read by current code. It is still
// computed and written for one compatibility release: BucksMatchPool.peekAvailableAt
// is now nullable so a rollback to the pre-removal image doesn't hit a missing
// column, but that old image's Prisma schema still declares the field
// non-null and its peek.ts candidate query decodes it unconditionally — a
// pool this code creates with a null value would fail to decode there. Stop
// computing this once this release is no longer a rollback target, and drop
// the column in the same follow-up migration (see prisma/schema.prisma).
const LEGACY_PEEK_AVAILABLE_DELAY_MS = 2 * 60 * 1000;

function computeLegacyPeekAvailableAt(input: {
  detectedAt: Date;
  gameStartTime: number;
  gameLength: number;
}): Date {
  return new Date(
    computeGameStartAt(input).getTime() + LEGACY_PEEK_AVAILABLE_DELAY_MS,
  );
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
 * This helper remains the authoritative gate for the guild-scoped wallet,
 * pool, and button surfaces.
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
};

/**
 * Create a pool per flag-enabled guild that this game is being announced in.
 *
 * Swallows every failure and answers an empty set, because on v1's inline
 * send a betting bug must never take the loading screen down with it. The V2
 * prematch path calls {@link openBettingPoolsStrict} instead: there the open
 * is its own guarded Activity, so a failure is retried rather than recorded
 * as "this game had no market".
 *
 * @returns the guilds that got a pool, so the caller knows where to attach
 * betting buttons
 */
export async function openBettingPoolsForPrematch(
  input: OpenPoolsInput,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<Set<DiscordGuildId>> {
  try {
    return await openBettingPoolsStrict(input, prismaClient);
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
}

/**
 * The pool open itself, with its failures left to the caller.
 *
 * Idempotent per (match, guild): `BucksMatchPool` is unique on exactly that
 * pair, so a repeat finds the standing pool, reports the guild as having one,
 * and neither extends its window nor reopens it. A guild whose pool already
 * stands is reported whatever state that pool is in, exactly as v1's
 * re-detection always was.
 */
export async function openBettingPoolsStrict(
  input: OpenPoolsInput,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<Set<DiscordGuildId>> {
  const opened = new Set<DiscordGuildId>();
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
  const legacyPeekAvailableAt = computeLegacyPeekAvailableAt({
    detectedAt: input.detectedAt,
    gameStartTime: input.gameInfo.gameStartTime,
    gameLength: input.gameInfo.gameLength,
  });
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
          peekAvailableAt: legacyPeekAvailableAt,
          queueType: input.queueType ?? null,
          roster: JSON.stringify(roster),
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

const APPEND_MESSAGE_REF_ATTEMPTS = 8;

export type AppendPoolMessageRefOutcome =
  "recorded" | "already-recorded" | "no-pool";

/**
 * Add ONE delivered prematch message to a pool's refs, at most once.
 *
 * v1 knows every message of a game at once and writes the whole array in one
 * go ({@link recordPoolMessageRefs}). The V2 prematch path delivers each
 * channel from its own notification run, so several runs can record against
 * one guild's pool at the same moment, and a whole-array write would let the
 * last of them erase the others — losing a destination the settlement
 * announcement has no other record of.
 *
 * So this is a compare-and-set on the stored array: read it, and write the
 * extended array only where the column still holds exactly what was read. A
 * rival that wrote in between makes the guarded update match nothing, and the
 * loop re-reads. A ref already present is `already-recorded`, which is what a
 * retried follow-up Activity finds. `prematchContentBase` is written with the
 * ref, because the refresh that follows edits the message from it.
 *
 * Unlike {@link recordPoolMessageRefs} this THROWS on failure: its caller is
 * a Temporal Activity, and a retry is exactly what a lost write needs.
 */
export async function appendPoolMessageRef(
  input: {
    matchId: string;
    serverId: DiscordGuildId;
    ref: BucksMessageRef;
    prematchContentBase: string;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<AppendPoolMessageRefOutcome> {
  const where = {
    matchId_serverId: { matchId: input.matchId, serverId: input.serverId },
  };
  for (let attempt = 1; attempt <= APPEND_MESSAGE_REF_ATTEMPTS; attempt++) {
    const pool = await prismaClient.bucksMatchPool.findUnique({
      where,
      select: { messageRefs: true },
    });
    if (pool === null) return "no-pool";
    const refs = BucksMessageRefsSchema.parse(JSON.parse(pool.messageRefs));
    if (
      refs.some(
        (ref) =>
          ref.channelId === input.ref.channelId &&
          ref.messageId === input.ref.messageId,
      )
    ) {
      return "already-recorded";
    }
    const updated = await prismaClient.bucksMatchPool.updateMany({
      where: {
        matchId: input.matchId,
        serverId: input.serverId,
        messageRefs: pool.messageRefs,
      },
      data: {
        messageRefs: JSON.stringify([...refs, input.ref]),
        prematchContentBase: input.prematchContentBase,
      },
    });
    if (updated.count === 1) {
      bettingMessageRefsRecordedTotal.inc({ status: "recorded" });
      return "recorded";
    }
  }
  bettingMessageRefsRecordedTotal.inc({ status: "failed" });
  throw new Error(
    `The Bryan Bucks message refs for ${input.matchId} in guild ${input.serverId} changed under every one of ${APPEND_MESSAGE_REF_ATTEMPTS.toString()} append attempts`,
  );
}
