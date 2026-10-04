import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { ExploreQuotaSnapshotSchema } from "@scout-for-lol/data";
import { exploreQuotaLimits } from "#src/config/dynamic.ts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";

export type DurableQuotaRejection = {
  reason: string;
  retryAfterSeconds: number;
};

const ACTIVE_STATUSES = ["PENDING", "RUNNING"];
type QuotaClient = Pick<ExtendedPrismaClient, "scoutInteractiveRun">;

async function countSince(input: {
  database: QuotaClient;
  kind: "explore" | "report-ai";
  since: Date;
  ownerId?: DiscordAccountId;
  guildId?: DiscordGuildId;
}): Promise<number> {
  return await input.database.scoutInteractiveRun.count({
    where: {
      kind: input.kind,
      quotaExempt: false,
      createdAt: { gte: input.since },
      OR: [
        { state: { in: ACTIVE_STATUSES } },
        { providerAttemptAt: { not: null } },
      ],
      ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
      ...(input.guildId === undefined ? {} : { guildId: input.guildId }),
    },
  });
}

function startOfWindow(now: number, durationMs: number): Date {
  return new Date(now - (now % durationMs));
}

export async function durableExploreQuotaRejection(
  userId: DiscordAccountId,
  now = Date.now(),
  database: QuotaClient = prisma,
): Promise<DurableQuotaRejection | null> {
  const active = await database.scoutInteractiveRun.count({
    where: { kind: "explore", state: { in: ACTIVE_STATUSES } },
  });
  if (active >= 5) {
    return {
      reason: "Explore is busy right now. Try again shortly.",
      retryAfterSeconds: 30,
    };
  }
  if (
    (await database.scoutInteractiveRun.count({
      where: {
        kind: "explore",
        ownerId: userId,
        state: { in: ACTIVE_STATUSES },
      },
    })) > 0
  ) {
    return {
      reason: "You already have an Explore answer running.",
      retryAfterSeconds: 30,
    };
  }
  const limits = exploreQuotaLimits();
  const rules = [
    { durationMs: 60_000, limit: limits.userMinute, label: "minute" },
    { durationMs: 3_600_000, limit: limits.userHour, label: "hour" },
    { durationMs: 86_400_000, limit: limits.userDay, label: "day" },
    { durationMs: 604_800_000, limit: limits.userWeek, label: "week" },
  ];
  for (const rule of rules) {
    const start = startOfWindow(now, rule.durationMs);
    const used = await countSince({
      database,
      kind: "explore",
      ownerId: userId,
      since: start,
    });
    if (used >= rule.limit) {
      return {
        reason: `You have used ${used.toString()} of ${rule.limit.toString()} questions for this ${rule.label}.`,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((start.getTime() + rule.durationMs - now) / 1000),
        ),
      };
    }
  }
  const globalRules = [
    { durationMs: 3_600_000, limit: limits.globalHour, label: "hour" },
    { durationMs: 86_400_000, limit: limits.globalDay, label: "day" },
    { durationMs: 604_800_000, limit: limits.globalWeek, label: "week" },
  ];
  for (const rule of globalRules) {
    const start = startOfWindow(now, rule.durationMs);
    const used = await countSince({ database, kind: "explore", since: start });
    if (used >= rule.limit) {
      return {
        reason: `Explore has used ${used.toString()} of ${rule.limit.toString()} questions for this ${rule.label}.`,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((start.getTime() + rule.durationMs - now) / 1000),
        ),
      };
    }
  }
  return null;
}

/** The UI reads the same persistent counters and policy as reservation. */
export async function durableExploreQuotaStatus(
  userId: DiscordAccountId,
  now = Date.now(),
  database: QuotaClient = prisma,
) {
  const limits = exploreQuotaLimits();
  const rules = [
    {
      scope: "user",
      window: "minute",
      durationMs: 60_000,
      limit: limits.userMinute,
    },
    {
      scope: "user",
      window: "hour",
      durationMs: 3_600_000,
      limit: limits.userHour,
    },
    {
      scope: "user",
      window: "day",
      durationMs: 86_400_000,
      limit: limits.userDay,
    },
    {
      scope: "user",
      window: "week",
      durationMs: 604_800_000,
      limit: limits.userWeek,
    },
    {
      scope: "global",
      window: "hour",
      durationMs: 3_600_000,
      limit: limits.globalHour,
    },
    {
      scope: "global",
      window: "day",
      durationMs: 86_400_000,
      limit: limits.globalDay,
    },
    {
      scope: "global",
      window: "week",
      durationMs: 604_800_000,
      limit: limits.globalWeek,
    },
  ] as const;
  const quota = await Promise.all(
    rules.map(async (rule) => {
      const start = startOfWindow(now, rule.durationMs);
      const used = await countSince({
        database,
        kind: "explore",
        since: start,
        ...(rule.scope === "user" ? { ownerId: userId } : {}),
      });
      return ExploreQuotaSnapshotSchema.parse({
        scope: rule.scope,
        window: rule.window,
        used,
        limit: rule.limit,
        remaining: Math.max(0, rule.limit - used),
        resetsAt: new Date(start.getTime() + rule.durationMs).toISOString(),
      });
    }),
  );
  return { quota };
}

export async function durableReportAiQuotaRejection(
  identity: { userId: DiscordAccountId; guildId: DiscordGuildId },
  exempt: boolean,
  now = Date.now(),
  database: QuotaClient = prisma,
): Promise<DurableQuotaRejection | null> {
  const active = await database.scoutInteractiveRun.count({
    where: {
      kind: "report-ai",
      state: { in: ACTIVE_STATUSES },
    },
  });
  if (active >= 5) {
    return {
      reason: "AI report editing is busy. Try again shortly.",
      retryAfterSeconds: 60,
    };
  }
  const sameIdentityActive = await database.scoutInteractiveRun.count({
    where: {
      kind: "report-ai",
      ownerId: identity.userId,
      guildId: identity.guildId,
      state: { in: ACTIVE_STATUSES },
    },
  });
  if (sameIdentityActive > 0) {
    return {
      reason: "An AI report edit is already running for this server.",
      retryAfterSeconds: 60,
    };
  }
  if (exempt) return null;

  const rules = [
    { durationMs: 60_000, limit: 1, scope: "user_guild" },
    { durationMs: 3_600_000, limit: 3, scope: "user_guild" },
    { durationMs: 86_400_000, limit: 8, scope: "user_guild" },
    { durationMs: 604_800_000, limit: 30, scope: "user_guild" },
    { durationMs: 3_600_000, limit: 5, scope: "guild" },
    { durationMs: 86_400_000, limit: 20, scope: "guild" },
    { durationMs: 604_800_000, limit: 100, scope: "guild" },
    { durationMs: 3_600_000, limit: 30, scope: "global" },
    { durationMs: 86_400_000, limit: 150, scope: "global" },
    { durationMs: 604_800_000, limit: 500, scope: "global" },
  ] as const;
  for (const rule of rules) {
    const start = startOfWindow(now, rule.durationMs);
    const used = await countSince({
      database,
      kind: "report-ai",
      since: start,
      ...(rule.scope === "global" ? {} : { guildId: identity.guildId }),
      ...(rule.scope === "user_guild" ? { ownerId: identity.userId } : {}),
    });
    if (used >= rule.limit) {
      return {
        reason: "AI report editing quota is exhausted for this time window.",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((start.getTime() + rule.durationMs - now) / 1000),
        ),
      };
    }
  }
  return null;
}

async function lockQuotaScope(
  database: Pick<Db, "$executeRaw">,
  scope: string,
): Promise<void> {
  await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-interactive-quota'), hashtext(${scope}))`;
}

export async function lockDurableExploreConversation(
  database: Pick<Db, "$executeRaw">,
  conversationId: string,
): Promise<void> {
  await lockQuotaScope(database, `explore:conversation:${conversationId}`);
}

export async function durableExploreReservationRejection(input: {
  database: Db;
  ownerId: DiscordAccountId;
  conversationId: string;
  now?: number;
}): Promise<DurableQuotaRejection | null> {
  await lockQuotaScope(input.database, "explore:global");
  await lockQuotaScope(input.database, `explore:user:${input.ownerId}`);
  await lockDurableExploreConversation(input.database, input.conversationId);
  const activeConversationRun =
    await input.database.scoutInteractiveRun.findFirst({
      where: {
        kind: "explore",
        conversationId: input.conversationId,
        state: { in: ACTIVE_STATUSES },
      },
      select: { id: true },
    });
  if (activeConversationRun !== null) {
    return {
      reason: "This conversation already has an answer running.",
      retryAfterSeconds: 30,
    };
  }
  return await durableExploreQuotaRejection(
    input.ownerId,
    input.now,
    input.database,
  );
}

export async function createDurableExploreRunReservation(input: {
  database: Db;
  id: string;
  ownerId: DiscordAccountId;
  conversationId: string;
  payload: string;
}): Promise<void> {
  await input.database.scoutInteractiveRun.create({
    data: {
      id: input.id,
      kind: "explore",
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      payload: input.payload,
    },
  });
}

export async function reserveDurableExploreRun(input: {
  id: string;
  ownerId: DiscordAccountId;
  conversationId: string;
  payload: string;
  now?: number;
  database?: ExtendedPrismaClient;
}): Promise<DurableQuotaRejection | null> {
  const database = input.database ?? prisma;
  return await database.$transaction(async (tx) => {
    const rejection = await durableExploreReservationRejection({
      database: tx,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    if (rejection !== null) return rejection;
    await createDurableExploreRunReservation({
      database: tx,
      id: input.id,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      payload: input.payload,
    });
    return null;
  });
}

export async function reserveDurableReportAiRun(input: {
  id: string;
  identity: { userId: DiscordAccountId; guildId: DiscordGuildId };
  exempt: boolean;
  payload: string;
  now?: number;
  database?: ExtendedPrismaClient;
}): Promise<DurableQuotaRejection | null> {
  const database = input.database ?? prisma;
  return await database.$transaction(async (tx) => {
    await lockQuotaScope(tx, "report-ai:global");
    await lockQuotaScope(tx, `report-ai:guild:${input.identity.guildId}`);
    await lockQuotaScope(
      tx,
      `report-ai:identity:${input.identity.userId}:${input.identity.guildId}`,
    );
    const rejection = await durableReportAiQuotaRejection(
      input.identity,
      input.exempt,
      input.now,
      tx,
    );
    if (rejection !== null) return rejection;
    await tx.scoutInteractiveRun.create({
      data: {
        id: input.id,
        kind: "report-ai",
        ownerId: input.identity.userId,
        guildId: input.identity.guildId,
        quotaExempt: input.exempt,
        payload: input.payload,
      },
    });
    return null;
  });
}
