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
// Refresh returns the current state once the deadline has passed and leaves
// overdue marking to its own activity. The cross-region assertion needs a
// deadline that is still open when the test runs.
const OPEN_DEADLINE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function seriesAt(deadline: string) {
  return {
    id: SERIES_ID,
    guildId: "160509172704739328",
    channelId: "160509172704739329",
    seriesState: "awaiting_acceptance",
    deadlineAt: new Date(deadline),
    windowStartsAt: null,
    participants: [],
    games: [],
    competitorOne: { members: [{ region: "AMERICA_NORTH" }] },
    competitorTwo: { members: [{ region: "EU_WEST" }] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUniqueOrThrow.mockResolvedValue(seriesAt(OPEN_DEADLINE));
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

test("routes a frozen cross-region duel to review before lobby readiness", async () => {
  await expect(
    refreshDuelSeriesWorkflowState({
      stage: "dev",
      seriesId: SERIES_ID,
      deadlineAt: OPEN_DEADLINE,
    }),
  ).resolves.toEqual({
    terminal: true,
    status: "needs_review",
    deadlineAt: OPEN_DEADLINE,
  });
  expect(mocks.updateMany).toHaveBeenCalledWith({
    where: { id: SERIES_ID, seriesState: "awaiting_acceptance" },
    data: { seriesState: "needs_review" },
  });
  expect(mocks.duelRolloutAllowed).not.toHaveBeenCalled();
});

test("leaves a past-deadline cross-region duel unchanged for the overdue activity", async () => {
  const deadline = new Date(Date.now() - 60 * 1000).toISOString();
  mocks.findUniqueOrThrow.mockResolvedValue(seriesAt(deadline));

  await expect(
    refreshDuelSeriesWorkflowState({
      stage: "dev",
      seriesId: SERIES_ID,
      deadlineAt: deadline,
    }),
  ).resolves.toEqual({
    terminal: false,
    status: "awaiting_acceptance",
    deadlineAt: deadline,
  });
  expect(mocks.updateMany).not.toHaveBeenCalled();
  expect(mocks.duelRolloutAllowed).not.toHaveBeenCalled();
});
