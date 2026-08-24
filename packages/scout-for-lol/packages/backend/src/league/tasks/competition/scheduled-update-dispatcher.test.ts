import { describe, expect, test, vi } from "vitest";
import {
  CompetitionIdSchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type CompetitionWithCriteria,
} from "@scout-for-lol/data";
import { dispatchScheduledCompetitionUpdates } from "#src/league/tasks/competition/scheduled-update-dispatcher.ts";

function competition(
  id: number,
  scheduleTimezone = "America/Los_Angeles",
): CompetitionWithCriteria {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: CompetitionIdSchema.parse(id),
    serverId: DiscordGuildIdSchema.parse("100000000000000001"),
    ownerId: DiscordAccountIdSchema.parse("100000000000000002"),
    title: `Competition ${id.toString()}`,
    description: "Scheduled update test",
    channelId: DiscordChannelIdSchema.parse("100000000000000003"),
    isCancelled: false,
    visibility: "OPEN",
    maxParticipants: 50,
    analysisTimezone: "UTC",
    startDate: new Date("2025-12-01T00:00:00.000Z"),
    endDate: new Date("2026-12-01T00:00:00.000Z"),
    seasonId: null,
    startProcessedAt: now,
    endProcessedAt: null,
    scheduledUpdatesEnabled: true,
    updateCronExpression: "0 9 * * *",
    scheduleTimezone,
    nextScheduledUpdateAt: now,
    lastScheduledUpdateAt: null,
    startNotifiedAt: now,
    endNotifiedAt: null,
    startNotificationMessageId: "start-message",
    endNotificationMessageId: null,
    creatorDiscordId: DiscordAccountIdSchema.parse("100000000000000002"),
    createdTime: now,
    updatedTime: now,
    criteria: { type: "HIGHEST_RANK", queue: "SOLO" },
  };
}

describe("scheduled competition dispatcher", () => {
  test("posts due rows and advances in each saved timezone", async () => {
    const row = competition(1, "Asia/Tokyo");
    const advance = vi.fn(() => Promise.resolve());
    const result = await dispatchScheduledCompetitionUpdates({
      now: new Date("2026-01-01T00:01:00.000Z"),
      getDue: () => Promise.resolve([row]),
      post: () => Promise.resolve({ success: true }),
      advance,
      delay: () => Promise.resolve(),
    });
    expect(result).toEqual({ succeeded: 1, failed: 0 });
    expect(advance).toHaveBeenCalledWith(
      row,
      new Date("2026-01-02T00:00:00.000Z"),
      new Date("2026-01-01T00:01:00.000Z"),
    );
  });

  test("advances a failed post and continues to later competitions", async () => {
    const first = competition(1);
    const second = competition(2);
    const advance = vi.fn(() => Promise.resolve());
    const post = vi.fn((row: CompetitionWithCriteria) =>
      row.id === first.id
        ? Promise.reject(new Error("Discord unavailable"))
        : Promise.resolve({ success: true }),
    );
    const result = await dispatchScheduledCompetitionUpdates({
      now: new Date("2026-01-01T00:01:00.000Z"),
      getDue: () => Promise.resolve([first, second]),
      post,
      advance,
      delay: () => Promise.resolve(),
    });
    expect(result).toEqual({ succeeded: 1, failed: 1 });
    expect(post).toHaveBeenCalledTimes(2);
    expect(advance).toHaveBeenCalledTimes(2);
  });

  test("does no work when no enabled competition is due", async () => {
    const post = vi.fn(() => Promise.resolve({ success: true }));
    const advance = vi.fn(() => Promise.resolve());
    const result = await dispatchScheduledCompetitionUpdates({
      now: new Date("2026-01-01T00:01:00.000Z"),
      getDue: () => Promise.resolve([]),
      post,
      advance,
      delay: () => Promise.resolve(),
    });
    expect(result).toEqual({ succeeded: 0, failed: 0 });
    expect(post).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });
});
