import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  duelRolloutAllowed: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    duelSeries: {
      findUniqueOrThrow: mocks.findUniqueOrThrow,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock("#src/progression/duels/access.ts", () => ({
  duelRolloutAllowed: mocks.duelRolloutAllowed,
}));
vi.mock("#src/metrics/progression.ts", () => ({
  duelSeriesOverdue: { inc: vi.fn() },
  duelSeriesTransitions: { inc: vi.fn() },
}));

const { refreshDuelSeriesWorkflowState } =
  await import("#src/progression/duels/series-workflow-state.ts");

const SERIES_ID = "00000000-0000-4000-8000-000000000001";
const DEADLINE = "2026-09-22T12:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUniqueOrThrow.mockResolvedValue({
    id: SERIES_ID,
    guildId: "160509172704739328",
    channelId: "160509172704739329",
    seriesState: "awaiting_acceptance",
    deadlineAt: new Date(DEADLINE),
    windowStartsAt: null,
    participants: [],
    games: [],
    competitorOne: { members: [{ region: "AMERICA_NORTH" }] },
    competitorTwo: { members: [{ region: "EU_WEST" }] },
  });
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

test("routes a frozen cross-region duel to review before lobby readiness", async () => {
  await expect(
    refreshDuelSeriesWorkflowState({
      stage: "dev",
      seriesId: SERIES_ID,
      deadlineAt: DEADLINE,
    }),
  ).resolves.toEqual({
    terminal: true,
    status: "needs_review",
    deadlineAt: DEADLINE,
  });
  expect(mocks.updateMany).toHaveBeenCalledWith({
    where: { id: SERIES_ID, seriesState: "awaiting_acceptance" },
    data: { seriesState: "needs_review" },
  });
  expect(mocks.duelRolloutAllowed).not.toHaveBeenCalled();
});
