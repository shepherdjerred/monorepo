import { beforeEach, expect, test, vi } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
  SCOUT_V2_MATCH_RECEIPT_KINDS,
} from "@scout-for-lol/temporal/match-receipts-v2";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";

const mocks = vi.hoisted(() => ({
  prisma: {},
  readState: vi.fn(),
  resolveContext: vi.fn(),
  finalizeCustom: vi.fn(),
  awardBucks: vi.fn(),
  lateBindingSink: vi.fn(),
  settlementSink: {},
  mintStandingIntents: vi.fn(),
  duelNeedsTimeline: vi.fn(),
  fetchTimeline: vi.fn(),
  processDuel: vi.fn(),
  readLegacyCompletion: vi.fn(),
}));

vi.mock("#src/configuration.ts", () => ({
  default: { environment: "beta" },
}));
vi.mock("#src/database/index.ts", () => ({ prisma: mocks.prisma }));
vi.mock("#src/customs/riot-result-publication.ts", () => ({
  finalizeAndPublishManagedCustomResult: mocks.finalizeCustom,
}));
vi.mock("#src/betting/accounts/earnings.ts", () => ({
  awardBucksForMatch: mocks.awardBucks,
}));
vi.mock("#src/league/tasks/postmatch/match-report-standard.ts", () => ({
  fetchTimelineForDuelProgression: mocks.fetchTimeline,
}));
vi.mock("#src/league/tasks/postmatch/cursor-reconciliation.ts", () => ({
  readLegacyMatchCompletionV2: mocks.readLegacyCompletion,
}));
vi.mock("#src/progression/duels/results.ts", () => ({
  duelMatchNeedsTimeline: mocks.duelNeedsTimeline,
  processDuelResult: mocks.processDuel,
}));
vi.mock("#src/temporal/v2/match-context.ts", () => ({
  resolveScoutV2MatchContext: mocks.resolveContext,
}));
vi.mock("#src/temporal/v2/match-effects.ts", () => ({
  lateBindingEarningsCheckpointSink: mocks.lateBindingSink,
  mintStandingLateBindingEarningIntentsV2: mocks.mintStandingIntents,
}));
vi.mock("#src/temporal/v2/match-reads.ts", () => ({
  readMatchPipelineStateV2: mocks.readState,
}));

const { reconcileProcessedClientBinding } = await import("./late-binding.ts");
const riotMatchId = RiotMatchIdSchema.parse("NA1_1234567890");
const gameCreation = Date.parse("2026-09-21T12:00:00.000Z");
const matchData = {
  metadata: { matchId: riotMatchId },
  info: { gameCreation },
};

function pipelineState(
  receiptKinds: readonly string[],
  options: {
    readonly owner?: "legacy-v1" | "temporal-v2";
    readonly deliveryMode?: "live" | "silent-backfill";
    readonly policy?: "ARCHIVE_ONLY" | "FULL";
  } = {},
) {
  return {
    kind: "present",
    state: {
      riotMatchId,
      owner: { kind: options.owner ?? "temporal-v2" },
      policy: options.policy ?? "FULL",
      deliveryMode: options.deliveryMode ?? "live",
      promoted: true,
      receiptKinds,
      intents: [],
      trackedAccounts: {
        total: 1,
        cursorAdvanced: 0,
      },
    },
  } as const;
}

function expectBindingProjectors(): void {
  expect(mocks.finalizeCustom).toHaveBeenCalledWith(
    mocks.prisma,
    matchData,
    "SCOUT_CLIENT",
  );
  expect(mocks.awardBucks).toHaveBeenCalledWith(
    matchData,
    mocks.prisma,
    mocks.settlementSink,
  );
  expect(mocks.mintStandingIntents).toHaveBeenCalledWith({
    riotMatchId,
    gameCreation,
  });
  expect(mocks.fetchTimeline).toHaveBeenCalledWith(matchData, riotMatchId, []);
  expect(mocks.processDuel).toHaveBeenCalledWith(
    matchData,
    { info: { frames: [] } },
    "beta",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readState.mockResolvedValue({ kind: "absent" });
  mocks.resolveContext.mockResolvedValue({
    matchId: riotMatchId,
    matchData,
    matchDataSource: "SCOUT_CLIENT",
    trackedPlayers: [],
  });
  mocks.duelNeedsTimeline.mockResolvedValue(true);
  mocks.fetchTimeline.mockResolvedValue({ info: { frames: [] } });
  mocks.awardBucks.mockResolvedValue([]);
  mocks.lateBindingSink.mockReturnValue(mocks.settlementSink);
  mocks.mintStandingIntents.mockResolvedValue(undefined);
  mocks.readLegacyCompletion.mockResolvedValue({ completed: false });
});

test("leaves a new match for its ordinary workflow", async () => {
  await expect(reconcileProcessedClientBinding(riotMatchId)).resolves.toBe(
    false,
  );

  expect(mocks.resolveContext).not.toHaveBeenCalled();
  expect(mocks.finalizeCustom).not.toHaveBeenCalled();
  expect(mocks.awardBucks).not.toHaveBeenCalled();
});

test("leaves an active match pipeline to consume the binding", async () => {
  mocks.readState.mockResolvedValue(
    pipelineState([SCOUT_V2_MATCH_RECEIPT_KINDS.observation]),
  );

  await expect(reconcileProcessedClientBinding(riotMatchId)).rejects.toThrow(
    "is still applying binding-dependent stages",
  );

  expect(mocks.resolveContext).not.toHaveBeenCalled();
  expect(mocks.finalizeCustom).not.toHaveBeenCalled();
  expect(mocks.awardBucks).not.toHaveBeenCalled();
});

test("leaves a legacy-owned match until its workflow completes", async () => {
  mocks.readState.mockResolvedValue(
    pipelineState(
      [
        SCOUT_V2_MATCH_RECEIPT_KINDS.settlement,
        SCOUT_V2_MATCH_RECEIPT_KINDS.progression,
      ],
      { owner: "legacy-v1" },
    ),
  );

  await expect(reconcileProcessedClientBinding(riotMatchId)).rejects.toThrow(
    "is still applying binding-dependent stages",
  );

  expect(mocks.resolveContext).not.toHaveBeenCalled();
  expect(mocks.finalizeCustom).not.toHaveBeenCalled();
  expect(mocks.awardBucks).not.toHaveBeenCalled();
});

test("acknowledges a durable terminal reconciliation without replaying it", async () => {
  mocks.readState.mockResolvedValue(
    pipelineState([SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND]),
  );

  await expect(reconcileProcessedClientBinding(riotMatchId)).resolves.toBe(
    false,
  );

  expect(mocks.resolveContext).not.toHaveBeenCalled();
  expect(mocks.finalizeCustom).not.toHaveBeenCalled();
  expect(mocks.awardBucks).not.toHaveBeenCalled();
});

test("replays binding-dependent projectors after their stage receipts stand", async () => {
  mocks.readState.mockResolvedValue(
    pipelineState([
      SCOUT_V2_MATCH_RECEIPT_KINDS.settlement,
      SCOUT_V2_MATCH_RECEIPT_KINDS.progression,
      SCOUT_V2_MATCH_RECEIPT_KINDS.tournament,
    ]),
  );

  await expect(reconcileProcessedClientBinding(riotMatchId)).resolves.toBe(
    true,
  );

  expectBindingProjectors();
});

test("checkpoints and mints earnings created by a live late binding", async () => {
  const earnings = [
    {
      serverId: "1337623164146155593",
      discordId: bucksTestDiscordId(1),
      alias: "jerred",
      reasons: ["played"],
      total: 1,
    },
  ];
  mocks.awardBucks.mockResolvedValue(earnings);
  mocks.readState.mockResolvedValue(
    pipelineState([
      SCOUT_V2_MATCH_RECEIPT_KINDS.settlement,
      SCOUT_V2_MATCH_RECEIPT_KINDS.progression,
      SCOUT_V2_MATCH_RECEIPT_KINDS.tournament,
    ]),
  );

  await expect(reconcileProcessedClientBinding(riotMatchId)).resolves.toBe(
    true,
  );

  expect(mocks.lateBindingSink).toHaveBeenCalledWith(riotMatchId, true);
  expect(mocks.awardBucks).toHaveBeenCalledWith(
    matchData,
    mocks.prisma,
    mocks.settlementSink,
  );
  expect(mocks.mintStandingIntents).toHaveBeenCalledWith({
    riotMatchId,
    gameCreation,
  });
});

test("keeps late-binding earnings silent for a backfill", async () => {
  mocks.awardBucks.mockResolvedValue([
    {
      serverId: "1337623164146155593",
      discordId: bucksTestDiscordId(1),
      alias: "jerred",
      reasons: ["played"],
      total: 1,
    },
  ]);
  mocks.readState.mockResolvedValue(
    pipelineState(
      [
        SCOUT_V2_MATCH_RECEIPT_KINDS.settlement,
        SCOUT_V2_MATCH_RECEIPT_KINDS.progression,
        SCOUT_V2_MATCH_RECEIPT_KINDS.tournament,
      ],
      { deliveryMode: "silent-backfill" },
    ),
  );

  await expect(reconcileProcessedClientBinding(riotMatchId)).resolves.toBe(
    true,
  );

  expect(mocks.lateBindingSink).toHaveBeenCalledWith(riotMatchId, false);
  expect(mocks.mintStandingIntents).toHaveBeenCalledWith({
    riotMatchId,
    gameCreation,
  });
});

test("retains the ingress retry when durable delivery minting fails", async () => {
  mocks.readState.mockResolvedValue(
    pipelineState([
      SCOUT_V2_MATCH_RECEIPT_KINDS.settlement,
      SCOUT_V2_MATCH_RECEIPT_KINDS.progression,
      SCOUT_V2_MATCH_RECEIPT_KINDS.tournament,
    ]),
  );
  mocks.mintStandingIntents.mockRejectedValue(
    new Error("notification intent database unavailable"),
  );

  await expect(reconcileProcessedClientBinding(riotMatchId)).rejects.toThrow(
    "notification intent database unavailable",
  );

  expect(mocks.awardBucks).toHaveBeenCalledWith(
    matchData,
    mocks.prisma,
    mocks.settlementSink,
  );
  expect(mocks.duelNeedsTimeline).not.toHaveBeenCalled();
});

test("keeps ARCHIVE_ONLY late binding free of financial and progression effects", async () => {
  mocks.readState.mockResolvedValue(
    pipelineState([SCOUT_V2_MATCH_RECEIPT_KINDS.tournament], {
      policy: "ARCHIVE_ONLY",
    }),
  );

  await expect(reconcileProcessedClientBinding(riotMatchId)).resolves.toBe(
    true,
  );

  expect(mocks.finalizeCustom).toHaveBeenCalledWith(
    mocks.prisma,
    matchData,
    "SCOUT_CLIENT",
  );
  expect(mocks.awardBucks).not.toHaveBeenCalled();
  expect(mocks.mintStandingIntents).not.toHaveBeenCalled();
  expect(mocks.duelNeedsTimeline).not.toHaveBeenCalled();
  expect(mocks.fetchTimeline).not.toHaveBeenCalled();
  expect(mocks.processDuel).not.toHaveBeenCalled();
});

test("replays legacy binding projectors from authoritative workflow completion", async () => {
  mocks.readState.mockResolvedValue(pipelineState([], { owner: "legacy-v1" }));
  mocks.readLegacyCompletion.mockResolvedValue({ completed: true });

  await expect(reconcileProcessedClientBinding(riotMatchId)).resolves.toBe(
    true,
  );

  expectBindingProjectors();
  expect(mocks.readLegacyCompletion).toHaveBeenCalledWith({
    stage: "beta",
    riotMatchId,
  });
});
