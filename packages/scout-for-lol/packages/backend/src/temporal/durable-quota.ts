import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

type DurableQuotaRejection = {
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
  const rules = [
    { durationMs: 60_000, limit: 4, label: "minute" },
    { durationMs: 3_600_000, limit: 30, label: "hour" },
    { durationMs: 86_400_000, limit: 100, label: "day" },
    { durationMs: 604_800_000, limit: 300, label: "week" },
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
    { durationMs: 3_600_000, limit: 120, label: "hour" },
    { durationMs: 86_400_000, limit: 600, label: "day" },
    { durationMs: 604_800_000, limit: 2000, label: "week" },
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
  database: Pick<ExtendedPrismaClient, "$executeRaw">,
  scope: string,
): Promise<void> {
  await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-interactive-quota'), hashtext(${scope}))`;
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
    await lockQuotaScope(tx, "explore:global");
    await lockQuotaScope(tx, `explore:user:${input.ownerId}`);
    const rejection = await durableExploreQuotaRejection(
      input.ownerId,
      input.now,
      tx,
    );
    if (rejection !== null) return rejection;
    await tx.scoutInteractiveRun.create({
      data: {
        id: input.id,
        kind: "explore",
        ownerId: input.ownerId,
        conversationId: input.conversationId,
        payload: input.payload,
      },
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
