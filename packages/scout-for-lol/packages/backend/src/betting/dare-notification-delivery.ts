import type { Client } from "discord.js";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  DareNotificationCategorySchema,
  DareNotificationKindSchema,
} from "#src/betting/dare-notification-outbox.ts";
import { getBucksNotificationPreferences } from "#src/betting/notification-preferences.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";
import { sendDM, type DmStatus } from "#src/discord/utils/dm.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("dare-notification-delivery");
const MAX_ATTEMPTS = 5;
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
const BASE_RETRY_MS = 60 * 1000;

const DareNotificationPayloadSchema = z.object({
  serverId: DiscordGuildIdSchema,
  summary: z.string().min(1),
});

const DareNotificationEventSchema = z.object({
  category: DareNotificationCategorySchema,
  kind: DareNotificationKindSchema,
  payload: z.string().transform((value, context) => {
    try {
      return DareNotificationPayloadSchema.parse(JSON.parse(value));
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid payload",
      });
      return z.NEVER;
    }
  }),
});

type DeliveryRow = {
  id: number;
  discordId: string;
  attemptCount: number;
  event: {
    category: string;
    kind: string;
    payload: string;
  };
};

export type DareNotificationDeliveryDependencies = {
  client: Client;
  isPolicyEnabled: typeof isPolicyEnabled;
  getPreferences: typeof getBucksNotificationPreferences;
  sendDm: typeof sendDM;
};

const defaultDependencies: DareNotificationDeliveryDependencies = {
  client,
  isPolicyEnabled,
  getPreferences: getBucksNotificationPreferences,
  sendDm: sendDM,
};

function retryAt(attemptCount: number, now: Date): Date {
  const exponent = Math.max(0, attemptCount - 1);
  return new Date(now.getTime() + BASE_RETRY_MS * 2 ** exponent);
}

function renderMessage(input: {
  dareId: number;
  kind: z.infer<typeof DareNotificationKindSchema>;
  summary: string;
}): string {
  const label = input.kind.replaceAll("_", " ");
  return `**Dare #${input.dareId.toString()} — ${label}**\n${input.summary}`;
}

async function finalizeDelivery(
  db: ExtendedPrismaClient,
  input: {
    id: number;
    status: string;
    attemptCount: number;
    now: Date;
    error?: string | undefined;
  },
): Promise<void> {
  await db.bucksDareNotificationDelivery.update({
    where: { id: input.id },
    data: {
      deliveryState: input.status,
      attemptCount: input.attemptCount,
      lastAttemptAt: input.now,
      lastError: input.error ?? null,
      nextAttemptAt:
        input.status === "retry"
          ? retryAt(input.attemptCount, input.now)
          : null,
      sentAt: input.status === "sent" ? input.now : null,
    },
  });
}

async function claimDelivery(
  db: ExtendedPrismaClient,
  row: DeliveryRow,
  now: Date,
): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const claimed = await db.bucksDareNotificationDelivery.updateMany({
    where: {
      id: row.id,
      OR: [
        { deliveryState: "pending" },
        { deliveryState: "retry", nextAttemptAt: { lte: now } },
        {
          deliveryState: "delivering",
          lastAttemptAt: { lte: staleBefore },
        },
      ],
    },
    data: { deliveryState: "delivering", lastAttemptAt: now },
  });
  return claimed.count === 1;
}

async function recordSendOutcome(
  db: ExtendedPrismaClient,
  row: DeliveryRow,
  status: DmStatus,
  now: Date,
): Promise<void> {
  const attemptCount = row.attemptCount + 1;
  if (status === "sent") {
    await finalizeDelivery(db, {
      id: row.id,
      status: "sent",
      attemptCount,
      now,
    });
    return;
  }
  if (status === "dm_disabled" || status === "budget_exhausted") {
    await finalizeDelivery(db, {
      id: row.id,
      status: "permanent_failure",
      attemptCount,
      now,
      error: status,
    });
    return;
  }
  await finalizeDelivery(db, {
    id: row.id,
    status: attemptCount >= MAX_ATTEMPTS ? "exhausted" : "retry",
    attemptCount,
    now,
    error: status,
  });
}

async function deliverOne(
  row: DeliveryRow & { event: DeliveryRow["event"] & { dareId: number } },
  db: ExtendedPrismaClient,
  dependencies: DareNotificationDeliveryDependencies,
  now: Date,
): Promise<void> {
  if (!(await claimDelivery(db, row, now))) return;

  const parsed = DareNotificationEventSchema.safeParse(row.event);
  if (!parsed.success) {
    await finalizeDelivery(db, {
      id: row.id,
      status: "permanent_failure",
      attemptCount: row.attemptCount + 1,
      now,
      error: parsed.error.message,
    });
    return;
  }
  const { category, kind, payload } = parsed.data;
  const enabled = await dependencies.isPolicyEnabled(
    "dare_notifications_enabled",
    { server: payload.serverId },
  );
  if (!enabled) {
    await finalizeDelivery(db, {
      id: row.id,
      status: "suppressed",
      attemptCount: row.attemptCount,
      now,
      error: "feature_disabled",
    });
    return;
  }
  const discordId = DiscordAccountIdSchema.parse(row.discordId);
  const preferences = await dependencies.getPreferences(
    { serverId: payload.serverId, discordId },
    db,
  );
  const preferenceEnabled =
    category === "lifecycle"
      ? preferences.dareLifecycleDms
      : preferences.dareProgressDms;
  if (!preferenceEnabled) {
    await finalizeDelivery(db, {
      id: row.id,
      status: "suppressed",
      attemptCount: row.attemptCount,
      now,
      error: "recipient_preference",
    });
    return;
  }
  const status = await dependencies.sendDm({
    client: dependencies.client,
    userId: discordId,
    guildId: payload.serverId,
    kind: "dare_notification",
    message: renderMessage({
      dareId: row.event.dareId,
      kind,
      summary: payload.summary,
    }),
    suppressMentions: true,
    prisma: db,
  });
  await recordSendOutcome(db, row, status, now);
}

export async function deliverPendingDareNotifications(
  prismaClient: ExtendedPrismaClient = prisma,
  dependencies: DareNotificationDeliveryDependencies = defaultDependencies,
  now = new Date(),
): Promise<void> {
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const rows = await prismaClient.bucksDareNotificationDelivery.findMany({
    where: {
      OR: [
        { deliveryState: "pending" },
        { deliveryState: "retry", nextAttemptAt: { lte: now } },
        {
          deliveryState: "delivering",
          lastAttemptAt: { lte: staleBefore },
        },
      ],
    },
    include: {
      event: {
        select: { dareId: true, category: true, kind: true, payload: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  const outcomes = await Promise.allSettled(
    rows.map(async (row) => {
      await deliverOne(row, prismaClient, dependencies, now);
    }),
  );
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      logger.error("Dare notification delivery failed:", outcome.reason);
    }
  }
}
