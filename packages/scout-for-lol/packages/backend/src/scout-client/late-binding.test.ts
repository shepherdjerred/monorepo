import { beforeEach, expect, test, vi } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";

const mocks = vi.hoisted(() => ({
  prisma: {},
  readState: vi.fn(),
  resolveContext: vi.fn(),
  finalizeCustom: vi.fn(),
  duelNeedsTimeline: vi.fn(),
  fetchTimeline: vi.fn(),
  processDuel: vi.fn(),
}));

vi.mock("#src/configuration.ts", () => ({
  default: { environment: "beta" },
}));
vi.mock("#src/database/index.ts", () => ({ prisma: mocks.prisma }));
vi.mock("#src/customs/riot-result-publication.ts", () => ({
  finalizeAndPublishManagedCustomResult: mocks.finalizeCustom,
}));
vi.mock("#src/league/tasks/postmatch/match-report-standard.ts", () => ({
  fetchTimelineForDuelProgression: mocks.fetchTimeline,
}));
vi.mock("#src/progression/duels/results.ts", () => ({
  duelMatchNeedsTimeline: mocks.duelNeedsTimeline,
  processDuelResult: mocks.processDuel,
}));
vi.mock("#src/temporal/v2/match-context.ts", () => ({
  resolveScoutV2MatchContext: mocks.resolveContext,
}));
vi.mock("#src/temporal/v2/match-reads.ts", () => ({
  readMatchPipelineStateV2: mocks.readState,
}));

const { reconcileProcessedClientBinding } = await import("./late-binding.ts");
const riotMatchId = RiotMatchIdSchema.parse("NA1_1234567890");
const matchData = { metadata: { matchId: riotMatchId } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readState.mockResolvedValue({ kind: "absent" });
  mocks.resolveContext.mockResolvedValue({
    matchId: riotMatchId,
    matchData,
    trackedPlayers: [],
  });
  mocks.duelNeedsTimeline.mockResolvedValue(true);
  mocks.fetchTimeline.mockResolvedValue({ info: { frames: [] } });
});

test("leaves a new match for its ordinary workflow", async () => {
  await expect(reconcileProcessedClientBinding(riotMatchId)).resolves.toBe(
    false,
  );

  expect(mocks.resolveContext).not.toHaveBeenCalled();
  expect(mocks.finalizeCustom).not.toHaveBeenCalled();
});

test("replays binding-dependent projectors for an already observed match", async () => {
  mocks.readState.mockResolvedValue({ kind: "present", state: {} });

  await expect(reconcileProcessedClientBinding(riotMatchId)).resolves.toBe(
    true,
  );

  expect(mocks.finalizeCustom).toHaveBeenCalledWith(mocks.prisma, matchData);
  expect(mocks.fetchTimeline).toHaveBeenCalledWith(matchData, riotMatchId, []);
  expect(mocks.processDuel).toHaveBeenCalledWith(
    matchData,
    { info: { frames: [] } },
    "beta",
  );
});
