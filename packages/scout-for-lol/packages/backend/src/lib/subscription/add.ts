import {
  DiscordAccountIdSchema,
  type DiscordAccountId,
  LeaguePuuidSchema,
  type LeaguePuuid,
  type Region,
} from "@scout-for-lol/data/index.ts";
import { backfillLastMatchTime } from "#src/league/api/backfill-match-history.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import type { Db } from "#src/lib/audit/index.ts";
import type {
  AddSubscriptionInput,
  AddSubscriptionResult,
} from "#src/lib/subscription/types.ts";
import { resolveRiotIdToPuuid } from "#src/lib/subscription/resolve.ts";
import { checkSubscriptionAndAccountLimits } from "#src/lib/subscription/limits.ts";

const logger = createLogger("subscription-add");

/**
 * Create the Player (if new), Account, and Subscription rows for a
 * subscription request. Pure DB work — assumes the PUUID has already
 * been resolved (call resolveRiotIdToPuuid first). Limits are
 * re-checked inside the txn to close the race window between two
 * concurrent adds for the same guild.
 *
 * Backfill is intentionally NOT done here — long-running external
 * calls don't belong in a DB transaction. Callers run
 * backfillLastMatchTime as a best-effort step AFTER this resolves.
 */
async function commitSubscription(params: {
  input: AddSubscriptionInput;
  puuid: LeaguePuuid;
  db: Db;
}): Promise<AddSubscriptionResult> {
  const { input, puuid, db } = params;
  const {
    guildId,
    channelId,
    region,
    riotId,
    alias,
    discordUserId,
    creatorDiscordId,
  } = input;
  const now = new Date();

  const existingPlayer = await db.player.findUnique({
    where: { serverId_alias: { serverId: guildId, alias } },
  });
  const isAddingToExistingPlayer = existingPlayer !== null;

  // Re-check limits inside the txn — a count taken before is meaningless
  // under concurrent writers.
  const limits = await checkSubscriptionAndAccountLimits({
    guildId,
    isAddingToExistingPlayer,
    db,
  });
  if (limits.kind !== "ok") {
    return limits;
  }

  // Existing-account collision must be inside the txn too; another
  // request could have inserted the same PUUID between our pre-flight
  // and this txn.
  const existingAccount = await db.account.findUnique({
    where: { serverId_puuid: { serverId: guildId, puuid } },
    include: { player: { include: { subscriptions: true } } },
  });
  if (existingAccount) {
    return {
      kind: "account-already-subscribed",
      existingPlayerAlias: existingAccount.player.alias,
      channelIds: existingAccount.player.subscriptions.map((s) => s.channelId),
    };
  }

  const account = await db.account.create({
    data: {
      alias,
      puuid,
      region,
      // Seed the cached Riot ID from input; refreshed/canonicalized on read.
      riotGameName: riotId.game_name,
      riotTagLine: riotId.tag_line,
      riotIdUpdatedAt: now,
      serverId: guildId,
      creatorDiscordId,
      player: {
        connectOrCreate: {
          where: { serverId_alias: { serverId: guildId, alias } },
          create: {
            alias,
            discordId: discordUserId ?? null,
            createdTime: now,
            updatedTime: now,
            creatorDiscordId,
            serverId: guildId,
          },
        },
      },
      createdTime: now,
      updatedTime: now,
    },
  });

  const playerAccount = await db.account.findUnique({
    where: { id: account.id },
    include: { player: { include: { accounts: true } } },
  });

  if (!playerAccount) {
    return {
      kind: "internal-error",
      message: "Failed to find player for newly created account",
    };
  }

  const existingSubscription = await db.subscription.findUnique({
    where: {
      serverId_playerId_channelId: {
        serverId: guildId,
        playerId: playerAccount.player.id,
        channelId,
      },
    },
  });

  if (existingSubscription) {
    return {
      kind: "subscription-already-exists",
      playerAlias: playerAccount.player.alias,
      addedToExistingPlayer: isAddingToExistingPlayer,
      accounts: playerAccount.player.accounts.map((a) => ({
        alias: a.alias,
        region: a.region,
      })),
    };
  }

  const existingSubscriptionCount = await db.subscription.count({
    where: { serverId: guildId },
  });
  const isFirstSubscription = existingSubscriptionCount === 0;

  const subscription = await db.subscription.create({
    data: {
      channelId,
      playerId: playerAccount.player.id,
      createdTime: now,
      updatedTime: now,
      creatorDiscordId: DiscordAccountIdSchema.parse(creatorDiscordId),
      serverId: guildId,
    },
  });

  return {
    kind: "created",
    subscription: { id: subscription.id },
    account: {
      id: playerAccount.id,
      puuid,
      region: playerAccount.region,
      alias: playerAccount.alias,
    },
    player: {
      id: playerAccount.player.id,
      alias: playerAccount.player.alias,
      accounts: playerAccount.player.accounts.map((a) => ({
        alias: a.alias,
        region: a.region,
      })),
    },
    isAddingToExistingPlayer,
    isFirstSubscription,
    warnings: limits.warnings,
  };
}

/**
 * Resolve the Riot ID to a PUUID via the Riot API. Run BEFORE opening a
 * Prisma transaction — Riot calls can spike past Prisma's 5s tx timeout
 * and cause `P2028 Transaction already closed`. Returns the PUUID for
 * the caller to thread into `commitSubscription`.
 */
export async function resolveSubscriptionPuuid(
  riotId: AddSubscriptionInput["riotId"],
  region: AddSubscriptionInput["region"],
): Promise<
  | { kind: "ok"; puuid: LeaguePuuid }
  | { kind: "riot-id-not-found"; message: string }
> {
  const resolved = await resolveRiotIdToPuuid(riotId, region);
  if (resolved.kind !== "ok") {
    return { kind: "riot-id-not-found", message: resolved.message };
  }
  return { kind: "ok", puuid: LeaguePuuidSchema.parse(resolved.puuid) };
}

/**
 * Commit the subscription DB writes inside the supplied transaction.
 * Limits are re-checked under the same txn to close the race between
 * concurrent adds. Caller MUST have already resolved the PUUID via
 * `resolveSubscriptionPuuid` outside the transaction.
 *
 * Backfill is intentionally NOT done here — long-running external
 * calls don't belong in a DB transaction. Callers run
 * `runBackfillAfterCommit` after the transaction commits.
 */
export async function addSubscription(
  input: AddSubscriptionInput,
  puuid: LeaguePuuid,
  db: Db,
): Promise<AddSubscriptionResult> {
  try {
    return await commitSubscription({ input, puuid, db });
  } catch (error) {
    logger.error("❌ Database error during subscription:", error);
    return { kind: "internal-error", message: getErrorMessage(error) };
  }
}

/**
 * Best-effort: backfill match history after the subscription commits.
 * Called by the caller AFTER the transaction has resolved successfully.
 * If this fails the next poll cycle will populate match history; we
 * don't want a flaky external call to orphan the account.
 */
export async function runBackfillAfterCommit(params: {
  alias: string;
  puuid: LeaguePuuid;
  region: Region;
  discordUserId: DiscordAccountId | undefined;
}): Promise<void> {
  try {
    await backfillLastMatchTime(
      {
        alias: params.alias,
        league: {
          leagueAccount: { puuid: params.puuid, region: params.region },
        },
        discordAccount: { id: params.discordUserId },
      },
      params.puuid,
    );
  } catch (error) {
    logger.warn(
      "Backfill failed after subscription create — match history will populate on next poll",
      { error, puuid: params.puuid },
    );
  }
}
