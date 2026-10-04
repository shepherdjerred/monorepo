import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { EmbedBuilder } from "discord.js";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { MatchNotificationIntentRecordSchema } from "#src/database/durable/intent-row.ts";
import {
  freezeNotificationMessage,
  confirmNotificationTip,
  settleNotificationTip,
  settleTerminalNotificationTips,
} from "#src/temporal/v2/notification/notification-presentation.ts";
import { claimTip } from "#src/tips/tip-state.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { NotificationIntentSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  upsertIntent,
  transitionIntent,
} from "#src/database/durable/intent-repository.ts";
import { expire } from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";

const { prisma } = createTestDatabase("notification-presentation");
const selection = vi.hoisted(() => ({
  selectTip: vi.fn(async () => ({
    key: "scheduled-reports",
    flags: [],
    text: "Tip: schedule a report.",
  })),
}));
vi.mock("#src/tips/tip-selection.ts", () => ({
  selectTip: selection.selectTip,
}));
beforeEach(async () => {
  await prisma.matchNotificationIntent.deleteMany();
  await prisma.notificationPresentation.deleteMany();
  await prisma.featureTipImpression.deleteMany();
  await prisma.supportTouchpoint.deleteMany();
  vi.clearAllMocks();
});
afterAll(async () => {
  await prisma.$disconnect();
});

function record(
  kind: "prematch" | "postmatch",
  suffix = "1",
  delivered = false,
) {
  return MatchNotificationIntentRecordSchema.parse({
    matchId: "NA1_9401",
    intent: {
      key: `${kind}-discord:NA1_9401:${suffix}`,
      kind,
      origin: { kind: "live" },
      target: { kind: "channel", channelId: "100000000000000001" },
      attemptCount: 1,
      state: delivered
        ? {
            kind: "delivered",
            messageId: "100000000000000003",
            deliveredAt: "2026-10-01T00:00:00.000Z",
          }
        : { kind: "ready" },
      createdAt: "2026-10-01T00:00:00.000Z",
      freshnessDeadline: "2099-01-01T00:00:00.000Z",
    },
  });
}
const guildId = "100000000000000002";

test("report support action is frozen across flag changes and delivered metrics deduplicate retries", async () => {
  addFlagOverride("scout_support_conversations_enabled", true, {});
  addFlagOverride("scout_support_report_action_enabled", true, {
    server: DiscordGuildIdSchema.parse(guildId),
  });
  try {
    const target = record("postmatch");
    const first = await freezeNotificationMessage(
      target,
      { content: "Report" },
      guildId,
      prisma,
    );
    expect(JSON.stringify(first)).toContain("support:contact:NA1_9401");
    expect(await prisma.supportTouchpoint.count()).toBe(0);
    resetFlagOverrides("scout_support_conversations_enabled");
    resetFlagOverrides("scout_support_report_action_enabled");
    const retry = await freezeNotificationMessage(
      target,
      { content: "Changed report" },
      guildId,
      prisma,
    );
    expect(JSON.stringify(retry)).toBe(JSON.stringify(first));
    await confirmNotificationTip(record("postmatch", "1", true), prisma);
    await confirmNotificationTip(record("postmatch", "1", true), prisma);
    expect(
      await prisma.supportTouchpoint.findMany({
        select: { surface: true, action: true },
      }),
    ).toEqual([{ surface: "REPORT", action: "DELIVERED" }]);
  } finally {
    resetFlagOverrides("scout_support_conversations_enabled");
    resetFlagOverrides("scout_support_report_action_enabled");
  }
});

test.each(["prematch", "postmatch"] as const)(
  "%s tips and furniture are frozen across retries and confirmed only after delivery",
  async (kind) => {
    const target = record(kind);
    const first = await freezeNotificationMessage(
      target,
      {
        content: "Original content",
        embeds: [new EmbedBuilder().setDescription("Original embed")],
      },
      guildId,
      prisma,
    );
    const retry = await freezeNotificationMessage(
      target,
      {
        content: "Changed content",
        embeds: [new EmbedBuilder().setDescription("Changed embed")],
      },
      guildId,
      prisma,
    );
    expect(JSON.stringify(retry)).toBe(JSON.stringify(first));
    expect(JSON.stringify(first)).toContain("Tip: schedule a report.");
    expect(selection.selectTip).toHaveBeenCalledTimes(1);
    const claimed = await prisma.featureTipImpression.findFirstOrThrow();
    expect(claimed.claimedAt).not.toBeNull();
    await confirmNotificationTip(target, prisma);
    const stillClaimed = await prisma.featureTipImpression.findFirstOrThrow();
    expect(stillClaimed.claimedAt).not.toBeNull();
    await confirmNotificationTip(record(kind, "1", true), prisma);
    const confirmed = await prisma.featureTipImpression.findFirstOrThrow();
    expect(confirmed.claimedAt).toBeNull();
  },
);

test("simultaneous targets claim a guild tip once", async () => {
  const results = await Promise.all(
    ["1", "2"].map(
      async (suffix) =>
        await freezeNotificationMessage(
          record("postmatch", suffix),
          { embeds: [new EmbedBuilder().setDescription("Match")] },
          guildId,
          prisma,
        ),
    ),
  );
  expect(
    results.filter((result) =>
      JSON.stringify(result).includes("Tip: schedule a report."),
    ),
  ).toHaveLength(1);
  expect(await prisma.featureTipImpression.count()).toBe(1);
  expect(await prisma.notificationPresentation.count()).toBe(2);
});

test("a failed snapshot validation rolls back both the claim and presentation", async () => {
  await expect(
    freezeNotificationMessage(
      record("postmatch"),
      {
        embeds: [
          { description: "Match", provider: { name: "unsupported furniture" } },
        ],
      },
      guildId,
      prisma,
    ),
  ).rejects.toThrow();
  expect(await prisma.featureTipImpression.count()).toBe(0);
  expect(await prisma.notificationPresentation.count()).toBe(0);
});

test("unknown attempts keep their claim; suppression releases it exactly once", async () => {
  const target = record("postmatch");
  await freezeNotificationMessage(
    target,
    { embeds: [new EmbedBuilder().setDescription("Match")] },
    guildId,
    prisma,
  );
  const unknown = NotificationIntentSchema.parse({
    ...target.intent,
    state: {
      kind: "unknown-delivery",
      attemptNonce: "attempt-1",
      observedAt: "2026-10-01T00:00:00.000Z",
    },
  });
  await prisma.$transaction(
    async (tx) => await settleNotificationTip(unknown, tx),
  );
  expect(await prisma.featureTipImpression.count()).toBe(1);
  const suppressed = NotificationIntentSchema.parse({
    ...target.intent,
    state: { kind: "suppressed", reason: "feature-disabled" },
  });
  await prisma.$transaction(
    async (tx) => await settleNotificationTip(suppressed, tx),
  );
  expect(await prisma.featureTipImpression.count()).toBe(0);
  expect(
    await claimTip(
      {
        serverId: DiscordGuildIdSchema.parse(guildId),
        tipKey: "scheduled-reports",
      },
      prisma,
    ),
  ).toBe(true);
  await prisma.$transaction(
    async (tx) => await settleNotificationTip(suppressed, tx),
  );
  expect(await prisma.featureTipImpression.count()).toBe(1);
});

test("the terminal sweep repairs a tip claim after an expiry committed independently", async () => {
  const target = record("postmatch");
  await upsertIntent(prisma, target);
  await freezeNotificationMessage(
    target,
    { embeds: [new EmbedBuilder().setDescription("Match")] },
    guildId,
    prisma,
  );
  await transitionIntent(prisma, {
    intentKey: target.intent.key,
    transition: expire,
  });
  expect(await prisma.featureTipImpression.count()).toBe(1);
  await settleTerminalNotificationTips(prisma);
  expect(await prisma.featureTipImpression.count()).toBe(0);
  await settleTerminalNotificationTips(prisma);
  expect(await prisma.featureTipImpression.count()).toBe(0);
});
