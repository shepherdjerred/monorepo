import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import type * as NotificationArtifactModule from "#src/temporal/notification/notification-artifact.ts";
import { hallBreakRecords } from "#src/temporal/notification/hall-record-break.test-fixtures.ts";
import {
  attemptRef,
  CHANNEL_ID,
} from "#src/temporal/notification-lane/notification-delivery.test-fixtures.ts";

/** Hall announcements retain their guild boundary. */

const stubs = vi.hoisted(() => ({
  requireIntentRecord: vi.fn(),
  resolveNotificationGate: vi.fn(),
  readAttestedReportArtifact: vi.fn(),
  readAttestedPrematchArtifact: vi.fn(),
  resolveScoutObservedMatchContext: vi.fn(),
  generateMatchReport: vi.fn(),
  fetchChannelForDelivery: vi.fn(),
  send: vi.fn(),
  isPolicyEnabled: vi.fn(),
  hallInstallationRetirementOf: vi.fn(),
  freshBotMember: vi.fn(),
}));

vi.mock("#src/configuration/flags.ts", async () => ({
  ...(await vi.importActual<Record<string, unknown>>(
    "#src/configuration/flags.ts",
  )),
  isPolicyEnabled: stubs.isPolicyEnabled,
}));

vi.mock("#src/temporal/notification-lane/notification-reads.ts", () => ({
  requireIntentRecord: stubs.requireIntentRecord,
}));
vi.mock("#src/temporal/notification/notification-policy.ts", () => ({
  resolveNotificationGate: stubs.resolveNotificationGate,
}));
vi.mock("#src/temporal/notification/prematch-notification.ts", () => ({
  buildPrematchNotificationMessage: vi.fn(),
}));
vi.mock("#src/temporal/notification/notification-artifact.ts", async () => {
  // The readers are stubbed so an announcement that touched one is visible;
  // the error class stays real because the delivery narrows on `instanceof`.
  const actual = await vi.importActual<typeof NotificationArtifactModule>(
    "#src/temporal/notification/notification-artifact.ts",
  );
  return {
    MalformedRenderReceiptError: actual.MalformedRenderReceiptError,
    readAttestedReportArtifact: stubs.readAttestedReportArtifact,
    readAttestedPrematchArtifact: stubs.readAttestedPrematchArtifact,
  };
});
vi.mock("#src/temporal/match/match-context.ts", () => ({
  resolveScoutObservedMatchContext: stubs.resolveScoutObservedMatchContext,
}));
vi.mock("#src/league/tasks/postmatch/match-report-generator.ts", () => ({
  generateMatchReport: stubs.generateMatchReport,
}));
vi.mock("#src/discord/utils/channel.ts", () => ({
  fetchChannelForDelivery: stubs.fetchChannelForDelivery,
}));
vi.mock("#src/discord/client.ts", () => ({ client: {} }));
vi.mock("#src/temporal/notification/intent-audience.ts", () => ({
  hallInstallationRetirementOf: stubs.hallInstallationRetirementOf,
}));
vi.mock("#src/lib/discord/bot-rest.ts", () => ({
  freshBotMember: stubs.freshBotMember,
}));
vi.mock("#src/league/discord/channel.ts", async () => {
  const { channelModuleWithSend } =
    await import("#src/temporal/notification-lane/notification-delivery.test-fixtures.ts");
  return await channelModuleWithSend(stubs.send);
});

const { deliverNotification } =
  await import("#src/temporal/notification-lane/notification-delivery.ts");

beforeEach(() => {
  vi.clearAllMocks();
  stubs.fetchChannelForDelivery.mockResolvedValue({ guildId: undefined });
  stubs.isPolicyEnabled.mockResolvedValue(true);
  stubs.hallInstallationRetirementOf.mockResolvedValue(undefined);
  stubs.freshBotMember.mockResolvedValue({
    joined_at: "2026-09-01T00:00:00.000Z",
  });
});

const HALL_INTENT_KEY = NotificationIntentKeySchema.parse(
  "hall-record-break:NA1_9301:100000000000000001",
);

function hallAttemptRef() {
  return { ...attemptRef(), intentKey: HALL_INTENT_KEY };
}

function hallRecordWith(records: unknown[]): unknown {
  return {
    matchId: "NA1_9301",
    intent: {
      key: HALL_INTENT_KEY,
      kind: "hall-record-break",
      origin: { kind: "live" },
      createdAt: "2026-09-12T00:00:00.000Z",
      target: { kind: "channel", channelId: CHANNEL_ID },
      announcement: {
        kind: "scout-hall-record-break-announcement",
        version: 1,
        data: {
          guildId: "100000000000000001",
          riotMatchId: "NA1_9301",
          records,
        },
      },
    },
  };
}

describe("the hall-shaped path", () => {
  // The hall arm is NOT mocked here: what is pinned is the real arm's
  // refusal reaching the delivery as a definite, terminal non-send.
  test("delivers a Hall record only to its resolved guild", async () => {
    stubs.requireIntentRecord.mockResolvedValue(
      hallRecordWith(hallBreakRecords()),
    );
    stubs.resolveNotificationGate.mockResolvedValue({
      decision: "permitted",
    });
    stubs.fetchChannelForDelivery.mockResolvedValue({
      guildId: "100000000000000001",
    });
    stubs.send.mockResolvedValue({ id: "100000000000000779" });

    expect(await deliverNotification(hallAttemptRef())).toEqual({
      outcome: "delivered",
      messageId: "100000000000000779",
    });
    expect(stubs.send).toHaveBeenCalledTimes(1);
  });

  test("an announcement whose every record was retired parks as content-unavailable, unsent", async () => {
    stubs.requireIntentRecord.mockResolvedValue(
      hallRecordWith([
        {
          matchId: "NA1_9301",
          gameEndAt: "2026-09-04T00:00:00.000Z",
          value: 1,
          holder: {
            playerId: 1,
            playerAlias: "Alice",
            accountId: 1,
            accountAlias: "Main",
            puuid:
              "hall-delivery-puuid00000000000000000000000000000000000000000000000000000000000",
          },
          queueFamilyId: "retired-anyway",
          recordId: "largest_multikill",
          holders: [],
        },
      ]),
    );
    stubs.resolveNotificationGate.mockResolvedValue({
      kind: "hall-record-break",
      target: "channel",
      policy: "normal",
      decision: "permitted",
    });

    const result = await deliverNotification(hallAttemptRef());

    expect(result).toEqual({
      outcome: "failed",
      failure: { classification: "terminal", reason: "content-unavailable" },
    });
    expect(stubs.send).not.toHaveBeenCalled();
  });

  test("records a late guild opt-out as a definite non-send", async () => {
    stubs.requireIntentRecord.mockResolvedValue(
      hallRecordWith(hallBreakRecords()),
    );
    stubs.resolveNotificationGate.mockResolvedValue({
      decision: "permitted",
    });
    stubs.fetchChannelForDelivery.mockResolvedValue({
      guildId: "100000000000000001",
    });
    stubs.isPolicyEnabled.mockResolvedValue(false);

    expect(await deliverNotification(hallAttemptRef())).toEqual({
      outcome: "suppressed",
      reason: "feature-disabled",
    });
    expect(stubs.send).not.toHaveBeenCalled();
  });

  test("refuses a Hall target resolved in another guild", async () => {
    stubs.requireIntentRecord.mockResolvedValue(
      hallRecordWith(hallBreakRecords()),
    );
    stubs.resolveNotificationGate.mockResolvedValue({
      decision: "permitted",
    });
    stubs.fetchChannelForDelivery.mockResolvedValue({
      guildId: "100000000000000002",
    });

    expect(await deliverNotification(hallAttemptRef())).toEqual({
      outcome: "failed",
      failure: { classification: "terminal", reason: "content-unavailable" },
    });
    expect(stubs.send).not.toHaveBeenCalled();
  });
});
