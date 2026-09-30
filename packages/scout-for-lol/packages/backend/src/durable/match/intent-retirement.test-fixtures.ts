import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
  type NotificationIntentKey,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  NotificationIntentSchema,
  type NotificationIntentKind,
} from "@scout-for-lol/domain/notifications/intent.ts";
import { markReady } from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import type { DiscordChannelId } from "@scout-for-lol/domain/identity/discord.ts";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  transitionIntent,
  upsertIntent,
} from "#src/database/durable/intent-repository.ts";
import { scoutDurableNotificationIntentsRetired } from "#src/metrics/durable-pipeline.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";

/**
 * Rows for the retirement suites: a subscription audience and the intents
 * minted for it, written the way the pipeline writes them.
 */

const SERVER_ID = testGuildId("7");
const CREATOR_ID = testAccountId("7");
const SEEDED_AT = new Date("2026-09-20T00:00:00.000Z");

/** Far past the life of the suites, so no row here is ever overdue. */
export const FRESH_DEADLINE = "2099-01-01T00:00:00.000Z";

/** One player following `puuid`, subscribed in `channelId`. */
export async function seedSubscription(
  prisma: ExtendedPrismaClient,
  args: { channelId: DiscordChannelId; puuid: LeaguePuuid; alias: string },
): Promise<{ subscriptionId: number }> {
  const player = await prisma.player.create({
    data: {
      alias: args.alias,
      serverId: SERVER_ID,
      creatorDiscordId: CREATOR_ID,
      createdTime: SEEDED_AT,
      updatedTime: SEEDED_AT,
      accounts: {
        create: {
          alias: args.alias,
          puuid: args.puuid,
          region: "AMERICA_NORTH",
          serverId: SERVER_ID,
          creatorDiscordId: CREATOR_ID,
          createdTime: SEEDED_AT,
          updatedTime: SEEDED_AT,
        },
      },
    },
  });
  const subscription = await prisma.subscription.create({
    data: {
      playerId: player.id,
      channelId: args.channelId,
      serverId: SERVER_ID,
      creatorDiscordId: CREATOR_ID,
      createdTime: SEEDED_AT,
      updatedTime: SEEDED_AT,
    },
  });
  return { subscriptionId: subscription.id };
}

/** Record that `puuid` was a tracked account in `matchId`. */
export async function seedTrackedAccount(
  prisma: ExtendedPrismaClient,
  args: { matchId: string; puuid: LeaguePuuid },
): Promise<void> {
  await prisma.matchTrackedAccount.create({
    data: { riotMatchId: args.matchId, puuid: args.puuid },
  });
}

/**
 * A client whose FIRST guarded intent write runs `interpose` beforehand.
 *
 * A sweep has already read the row by then, so `interpose` is a writer that
 * commits between that read and the sweep's write — the race the repository's
 * state guard exists for. `raced()` says whether the interposition happened.
 */
export function raceFirstIntentUpdate(
  prisma: ExtendedPrismaClient,
  interpose: () => Promise<void>,
): { db: ExtendedPrismaClient; raced: () => boolean } {
  let raced = false;
  const db = new Proxy(prisma, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (property !== "matchNotificationIntent") return value;
      const delegate = target.matchNotificationIntent;
      return new Proxy(delegate, {
        get(inner, innerProperty, innerReceiver) {
          if (innerProperty !== "updateMany" || raced) {
            const member: unknown = Reflect.get(
              inner,
              innerProperty,
              innerReceiver,
            );
            return member;
          }
          return async (args: Parameters<typeof delegate.updateMany>[0]) => {
            raced = true;
            await interpose();
            return await delegate.updateMany(args);
          };
        },
      });
    },
  });
  return { db, raced: () => raced };
}

/** How many retirements the counter holds for one reason and source. */
export async function retiredCount(
  reason: string,
  source: string,
): Promise<number> {
  const metric = await scoutDurableNotificationIntentsRetired.get();
  const series = metric.values.find(
    (value) => value.labels.reason === reason && value.labels.source === source,
  );
  return series?.value ?? 0;
}

/** One live channel intent, minted `pending` and optionally marked ready. */
export async function seedChannelIntent(
  prisma: ExtendedPrismaClient,
  args: {
    name: string;
    matchId: string;
    channelId: string;
    state: "pending" | "ready";
    kind?: NotificationIntentKind;
    freshnessDeadline?: string;
  },
): Promise<NotificationIntentKey> {
  const kind = args.kind ?? "postmatch";
  const key = NotificationIntentKeySchema.parse(
    `${kind}-discord:${args.matchId}:${args.name}`,
  );
  const announces = kind === "settlement" || kind === "dare-summary";
  const outcome = await upsertIntent(prisma, {
    matchId: RiotMatchIdSchema.parse(args.matchId),
    intent: NotificationIntentSchema.parse({
      key,
      kind,
      origin: { kind: "live" },
      target: { kind: "channel", channelId: args.channelId },
      freshnessDeadline: args.freshnessDeadline ?? FRESH_DEADLINE,
      createdAt: SEEDED_AT.toISOString(),
      attemptCount: 0,
      ...(announces
        ? { announcement: { kind: "test-announcement", version: 1, data: {} } }
        : {}),
      state: { kind: "pending" },
    }),
  });
  if (outcome.outcome !== "applied") {
    throw new Error(`seeding ${key} answered ${outcome.outcome}`);
  }
  if (args.state === "ready") {
    await transitionIntent(prisma, { intentKey: key, transition: markReady });
  }
  return key;
}
