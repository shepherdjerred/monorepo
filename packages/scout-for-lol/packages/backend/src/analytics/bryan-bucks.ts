import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type BucksLedgerKind,
} from "@scout-for-lol/data";
import {
  getProductAnalytics,
  type BucksActivitySurface,
  type BucksMemberActivityKind,
  type ProductAnalytics,
  type ProductAnalyticsEventOptions,
} from "#src/analytics/product-analytics.ts";
import type { BucksLifecycleTransition } from "#src/analytics/bryan-bucks-events.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";

const logger = createLogger("bryan-bucks-analytics");

type MemberActivityInput = {
  serverId: string | null;
  discordId: string;
  activityKind: BucksMemberActivityKind;
  surface: BucksActivitySurface;
  status: "success" | "error";
};

/**
 * Record member activity against the Bucks account's opaque analytics UUID.
 *
 * The Discord snowflake is used only to resolve the local account. It never
 * crosses the PostHog boundary, and house accounts are deliberately excluded
 * from member retention.
 */
export async function captureBucksMemberActivity(
  input: MemberActivityInput,
  options?: {
    db?: ExtendedPrismaClient;
    analytics?: ProductAnalytics;
  },
): Promise<void> {
  try {
    if (input.serverId === null) return;
    const serverId = DiscordGuildIdSchema.safeParse(input.serverId);
    const discordId = DiscordAccountIdSchema.safeParse(input.discordId);
    if (!serverId.success || !discordId.success) return;

    const defaultDatabase = await import("#src/database/index.ts");
    const db = options?.db ?? defaultDatabase.prisma;
    const analytics = options?.analytics ?? getProductAnalytics();
    const account = await db.bucksAccount.findUnique({
      where: {
        serverId_discordId: {
          serverId: serverId.data,
          discordId: discordId.data,
        },
      },
      select: { analyticsUserId: true, isHouse: true },
    });
    if (account === null || account.isHouse) return;

    analytics.captureBucksMember(
      { analyticsUserId: account.analyticsUserId, serverId: serverId.data },
      {
        event: "bryan_bucks_member_activity",
        properties: {
          activity_kind: input.activityKind,
          surface: input.surface,
          status: input.status,
        },
      },
    );
  } catch (error) {
    logger.error(
      "Failed to capture Bryan Bucks member analytics",
      getErrorMessage(error),
    );
  }
}

export function captureBucksLifecycle(input: {
  serverId: string | undefined;
  transition: BucksLifecycleTransition;
  amountBucks?: number | undefined;
  matchedBucks?: number | undefined;
  payoutBucks?: number | undefined;
  balanceAfterBucks?: number | undefined;
  options?: ProductAnalyticsEventOptions;
  analytics?: ProductAnalytics;
}): void {
  if (input.serverId === undefined) return;
  const serverId = DiscordGuildIdSchema.safeParse(input.serverId);
  if (!serverId.success) return;

  const analytics = input.analytics ?? getProductAnalytics();
  analytics.captureBucksSystem(
    serverId.data,
    {
      event: "bryan_bucks_lifecycle",
      properties: {
        transition: input.transition,
        amount_bucks: input.amountBucks,
        matched_bucks: input.matchedBucks,
        payout_bucks: input.payoutBucks,
        balance_after_bucks: input.balanceAfterBucks,
      },
    },
    input.options,
  );
}

export function captureBucksEconomy(input: {
  serverId: string;
  movement: BucksLedgerKind;
  deltaBucks: number;
  balanceAfterBucks: number;
  timestamp?: Date;
  uuid?: string;
  analytics?: ProductAnalytics;
}): void {
  const serverId = DiscordGuildIdSchema.safeParse(input.serverId);
  if (!serverId.success) return;

  const analytics = input.analytics ?? getProductAnalytics();
  analytics.captureBucksSystem(
    serverId.data,
    {
      event: "bryan_bucks_economy",
      properties: {
        movement: input.movement,
        delta_bucks: input.deltaBucks,
        balance_after_bucks: input.balanceAfterBucks,
      },
    },
    { timestamp: input.timestamp, uuid: input.uuid },
  );
}

export function captureBucksEconomySnapshot(input: {
  serverId: string;
  memberAccounts: number;
  totalMemberBalanceBucks: number;
  pendingStakeBucks: number;
  houseBalanceBucks: number;
  openMarkets: number;
  timestamp?: Date;
  uuid?: string;
  analytics?: ProductAnalytics;
}): void {
  const serverId = DiscordGuildIdSchema.safeParse(input.serverId);
  if (!serverId.success) return;

  const analytics = input.analytics ?? getProductAnalytics();
  analytics.captureBucksSystem(
    serverId.data,
    {
      event: "bryan_bucks_economy_snapshot",
      properties: {
        member_accounts: input.memberAccounts,
        total_member_balance_bucks: input.totalMemberBalanceBucks,
        pending_stake_bucks: input.pendingStakeBucks,
        house_balance_bucks: input.houseBalanceBucks,
        open_markets: input.openMarkets,
      },
    },
    { timestamp: input.timestamp, uuid: input.uuid },
  );
}
