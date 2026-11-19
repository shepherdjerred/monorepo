import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { ExploreQuotaSnapshotSchema } from "@scout-for-lol/data";
import { IN_GAME_SECTIONS } from "#src/coach/execution-profile.ts";
import { exploreQuotaLimits } from "#src/config/dynamic.ts";
import {
  EXPLORE_MAX_ACTIVE_RUNS,
  exploreQuotaRules,
} from "#src/configuration/explore-quota.ts";
import {
  REPORT_AI_MAX_ACTIVE_RUNS,
  REPORT_AI_QUOTA_RULES,
} from "#src/configuration/report-ai-quota.ts";
import { QUOTA_WINDOW_MS, type QuotaWindow } from "#src/utils/quota-buckets.ts";
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
type QuotaClient = Pick<
  ExtendedPrismaClient,
  "scoutInteractiveRun" | "scoutCoachTurn"
>;

/**
 * Which allowance admits an Explore turn. `in_game` is a turn the shared
 * in-game profile runs (`coach/execution-profile.ts`): its projected context
 * put the player in champion select or a game.
 */
export type ExploreQuotaAllowance = "explore" | "in_game";

/**
 * The in-game coach's own allowance, per player.
 *
 * Sized for abuse protection, not cost: a player asking every thirty seconds
 * through a long game stays inside it, while a looping client or a leaked
 * credential does not. Cost is bounded where it always is, by the spend
 * ledger and the provider account budgets. In-game turns are reserved
 * `quotaExempt`, so they never count against Explore's question windows and
 * Explore's windows never refuse them; the active-run limits apply to both.
 */
export const IN_GAME_COACH_QUOTA_RULES = [
  { window: "minute", limit: 10 },
  { window: "hour", limit: 120 },
  { window: "day", limit: 400 },
] as const satisfies readonly { window: QuotaWindow; limit: number }[];

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

/**
 * The in-game allowance's refusal, or null while the player has some left.
 * Counted from the coach audit rows whose champion-select or live section
 * reached the agent, which commit in the transaction that reserves each run.
 */
export async function inGameCoachQuotaRejection(
  userId: DiscordAccountId,
  now: number,
  database: QuotaClient,
): Promise<DurableQuotaRejection | null> {
  for (const rule of IN_GAME_COACH_QUOTA_RULES) {
    const durationMs = QUOTA_WINDOW_MS[rule.window];
    const start = startOfWindow(now, durationMs);
    const used = await database.scoutCoachTurn.count({
      where: {
        ownerId: userId,
        createdAt: { gte: start },
        sectionsAccepted: { hasSome: [...IN_GAME_SECTIONS] },
      },
    });
    if (used >= rule.limit) {
      return {
        reason: `You have used ${used.toString()} of ${rule.limit.toString()} in-game questions for this ${rule.window}.`,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((start.getTime() + durationMs - now) / 1000),
        ),
      };
    }
  }
  return null;
}

export async function durableExploreQuotaRejection(
  userId: DiscordAccountId,
  now = Date.now(),
  database: QuotaClient = prisma,
  allowance: ExploreQuotaAllowance = "explore",
): Promise<DurableQuotaRejection | null> {
  const active = await database.scoutInteractiveRun.count({
    where: { kind: "explore", state: { in: ACTIVE_STATUSES } },
  });
  if (active >= EXPLORE_MAX_ACTIVE_RUNS) {
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
  if (allowance === "in_game") {
    return await inGameCoachQuotaRejection(userId, now, database);
  }
  // Every user window is checked before any global one, so a person at their
  // own ceiling is told so rather than that Explore is busy.
  for (const rule of exploreQuotaRules(exploreQuotaLimits())) {
    const durationMs = QUOTA_WINDOW_MS[rule.window];
    const start = startOfWindow(now, durationMs);
    const used = await countSince({
      database,
      kind: "explore",
      since: start,
      ...(rule.scope === "user" ? { ownerId: userId } : {}),
    });
    if (used >= rule.limit) {
      const subject = rule.scope === "user" ? "You have" : "Explore has";
      return {
        reason: `${subject} used ${used.toString()} of ${rule.limit.toString()} questions for this ${rule.window}.`,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((start.getTime() + durationMs - now) / 1000),
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
  const rules = exploreQuotaRules(exploreQuotaLimits());
  const quota = await Promise.all(
    rules.map(async (rule) => {
      const durationMs = QUOTA_WINDOW_MS[rule.window];
      const start = startOfWindow(now, durationMs);
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
        resetsAt: new Date(start.getTime() + durationMs).toISOString(),
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
  if (active >= REPORT_AI_MAX_ACTIVE_RUNS) {
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

  for (const rule of REPORT_AI_QUOTA_RULES) {
    const durationMs = QUOTA_WINDOW_MS[rule.window];
    const start = startOfWindow(now, durationMs);
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
          Math.ceil((start.getTime() + durationMs - now) / 1000),
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
  allowance?: ExploreQuotaAllowance;
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
    input.allowance,
  );
}

export async function createDurableExploreRunReservation(input: {
  database: Db;
  id: string;
  ownerId: DiscordAccountId;
  conversationId: string;
  payload: string;
  allowance?: ExploreQuotaAllowance;
}): Promise<void> {
  await input.database.scoutInteractiveRun.create({
    data: {
      id: input.id,
      kind: "explore",
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      payload: input.payload,
      // An in-game turn spends its own allowance, counted from its audit row,
      // so it stays out of Explore's question windows.
      quotaExempt: input.allowance === "in_game",
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
