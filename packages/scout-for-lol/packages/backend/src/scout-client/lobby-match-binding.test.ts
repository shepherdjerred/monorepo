import { beforeEach, expect, test, vi } from "vitest";
import { ScoutClientObservationSchema } from "@scout-for-lol/data";

const mocks = vi.hoisted(() => ({
  findCustomByMatch: vi.fn(),
  findDuelByMatch: vi.fn(),
  findCustomCandidates: vi.fn(),
  findDuelCandidates: vi.fn(),
  findLobbyObservation: vi.fn(),
  findSupersedingLobby: vi.fn(),
  updateCustom: vi.fn(),
  updateDuel: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    customGame: {
      findUnique: mocks.findCustomByMatch,
      findMany: mocks.findCustomCandidates,
      updateMany: mocks.updateCustom,
    },
    duelGame: {
      findUnique: mocks.findDuelByMatch,
      findMany: mocks.findDuelCandidates,
      updateMany: mocks.updateDuel,
    },
    scoutClientObservation: {
      findUnique: mocks.findLobbyObservation,
      findFirst: mocks.findSupersedingLobby,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("#src/customs/socket.ts", () => ({
  publishCustomNightSnapshot: vi.fn(),
}));

const { bindObservedLobby, bindObservedMatch, projectObservedGameState } =
  await import("./lobby-binding.ts");
const participantPuuids = Array.from(
  { length: 10 },
  (_, index) => `${index.toString().padStart(2, "0")}${"a".repeat(76)}`,
);
const observation = ScoutClientObservationSchema.parse({
  protocolVersion: 1,
  schemaVersion: 1,
  observationId: "00000000-0000-4000-8000-000000000002",
  sequence: 2,
  capturedAt: "2026-09-20T12:30:00.000Z",
  appVersion: "0.1.0",
  kind: "post_game",
  platformId: "NA1",
  gameId: "1234567890",
  localPuuid: participantPuuids[0],
  payload: {
    resource: "post_game",
    data: {
      gameId: 1_234_567_890,
      platformId: "NA1",
      participants: participantPuuids.map((puuid) => ({ puuid })),
    },
  },
});
const customCandidate = {
  id: "custom-game",
  map: "SUMMONERS_RIFT",
  pickMode: "TOURNAMENT_DRAFT",
  observedLobbyId: "lobby-a",
  lobbyObservationId: "00000000-0000-4000-8000-000000000001",
  participants: participantPuuids.map((puuid, index) => ({
    puuid,
    side: index < 5 ? "BLUE" : "RED",
  })),
  auditEvents: [{ createdAt: new Date("2026-09-20T12:05:00.000Z") }],
};
const duelCandidate = {
  id: "duel-game",
  observedLobbyId: "lobby-a",
  lobbyObservationId: "00000000-0000-4000-8000-000000000001",
  updatedAt: new Date("2026-09-20T12:05:00.000Z"),
  series: {
    competitorOne: {
      members: participantPuuids.slice(0, 5).map((puuid) => ({ puuid })),
    },
    competitorTwo: {
      members: participantPuuids.slice(5).map((puuid) => ({ puuid })),
    },
  },
};
const lifecycleObservation = ScoutClientObservationSchema.parse({
  protocolVersion: 1,
  schemaVersion: 1,
  observationId: "00000000-0000-4000-8000-000000000004",
  sequence: 3,
  capturedAt: "2026-09-20T12:20:00.000Z",
  appVersion: "0.1.0",
  kind: "gameflow",
  localPuuid: participantPuuids[0],
  payload: {
    resource: "gameflow_session",
    data: {
      phase: "InProgress",
      gameData: {
        playerChampionSelections: participantPuuids.map((puuid) => ({ puuid })),
      },
    },
  },
});
const nakedLifecycleObservation = ScoutClientObservationSchema.parse({
  ...lifecycleObservation,
  observationId: "00000000-0000-4000-8000-000000000008",
  payload: { resource: "gameflow_phase", data: "InProgress" },
});
const staleLobbyObservation = ScoutClientObservationSchema.parse({
  protocolVersion: 1,
  schemaVersion: 1,
  observationId: "00000000-0000-4000-8000-000000000005",
  sequence: 1,
  capturedAt: "2026-09-20T12:00:00.000Z",
  appVersion: "0.1.0",
  kind: "lobby",
  lobbyId: "old-lobby",
  localPuuid: participantPuuids[0],
  payload: {
    resource: "lobby",
    data: {
      gameConfig: { mapId: 11, pickType: "TournamentDraft" },
      members: participantPuuids.map((puuid, index) => ({
        puuid,
        teamId: index < 5 ? 100 : 200,
      })),
    },
  },
});
const currentLobbyObservation = ScoutClientObservationSchema.parse({
  ...staleLobbyObservation,
  observationId: "00000000-0000-4000-8000-000000000006",
  capturedAt: "2026-09-20T12:30:00.000Z",
  lobbyId: "current-lobby",
});
const mixedTeamLobbyObservation = ScoutClientObservationSchema.parse({
  ...currentLobbyObservation,
  observationId: "00000000-0000-4000-8000-000000000009",
  payload: {
    resource: "lobby",
    data: {
      gameConfig: { mapId: 11, pickType: "TournamentDraft" },
      members: participantPuuids.map((puuid, index) => ({
        puuid,
        teamId: index === 0 ? 200 : index === 5 ? 100 : index < 5 ? 100 : 200,
      })),
    },
  },
});
const delayedPostGameObservation = ScoutClientObservationSchema.parse({
  ...observation,
  observationId: "00000000-0000-4000-8000-000000000007",
  capturedAt: "2026-09-20T12:30:00.000Z",
  payload: {
    resource: "post_game",
    data: {
      gameId: 1_234_567_890,
      platformId: "NA1",
      participants: participantPuuids.map((puuid) => ({ puuid })),
      timing: { gameEndTimestamp: Date.parse("2026-09-20T12:15:00.000Z") },
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findCustomByMatch.mockResolvedValue(null);
  mocks.findDuelByMatch.mockResolvedValue(null);
  mocks.findCustomCandidates.mockResolvedValue([customCandidate]);
  mocks.findDuelCandidates.mockResolvedValue([]);
  mocks.findLobbyObservation.mockResolvedValue({
    capturedAt: new Date("2026-09-20T12:00:00.000Z"),
  });
  mocks.findSupersedingLobby.mockResolvedValue(null);
  mocks.updateCustom.mockResolvedValue({ count: 1 });
  mocks.updateDuel.mockResolvedValue({ count: 1 });
});

test("binds the exact accepted post-game identity to the observed lobby", async () => {
  await bindObservedMatch(observation);

  expect(mocks.updateCustom).toHaveBeenCalledWith({
    where: { id: "custom-game", matchId: null },
    data: { matchId: "NA1_1234567890" },
  });
});

test("rejects a repeated roster after a different lobby was observed", async () => {
  mocks.findSupersedingLobby.mockResolvedValue({
    observationId: "00000000-0000-4000-8000-000000000003",
  });

  await bindObservedMatch(observation);

  expect(mocks.updateCustom).not.toHaveBeenCalled();
});

test("does not project lifecycle events after a different lobby was observed", async () => {
  mocks.findSupersedingLobby.mockResolvedValue({
    observationId: "00000000-0000-4000-8000-000000000003",
  });

  await projectObservedGameState(lifecycleObservation);

  expect(mocks.transaction).not.toHaveBeenCalled();
});

test("does not project a lifecycle phase without roster evidence", async () => {
  await expect(
    projectObservedGameState(nakedLifecycleObservation),
  ).resolves.toBe("unmatched");

  expect(mocks.transaction).not.toHaveBeenCalled();
});

test("does not project delayed post-game evidence onto a newer lobby", async () => {
  mocks.findCustomCandidates.mockResolvedValue([
    { ...customCandidate, matchId: "NA1_1234567890" },
  ]);
  mocks.findLobbyObservation.mockResolvedValue({
    capturedAt: new Date("2026-09-20T12:25:00.000Z"),
  });

  await projectObservedGameState(delayedPostGameObservation);

  expect(mocks.transaction).not.toHaveBeenCalled();
});

test("does not project post-game evidence onto a different bound match", async () => {
  mocks.findCustomCandidates.mockResolvedValue([
    { ...customCandidate, matchId: "NA1_9876543210" },
  ]);

  await projectObservedGameState(delayedPostGameObservation);

  expect(mocks.transaction).not.toHaveBeenCalled();
});

test("does not bind lobby evidence captured before the game became ready", async () => {
  mocks.findCustomCandidates.mockResolvedValue([
    { ...customCandidate, observedLobbyId: null, lobbyObservationId: null },
  ]);

  await bindObservedLobby(staleLobbyObservation);

  expect(mocks.updateCustom).not.toHaveBeenCalled();
});

test("does not bind a Custom lobby whose players changed assigned sides", async () => {
  await expect(bindObservedLobby(mixedTeamLobbyObservation)).resolves.toBe(
    "unmatched",
  );

  expect(mocks.updateCustom).not.toHaveBeenCalled();
});

test("does not bind a duel lobby whose competitors are mixed across sides", async () => {
  mocks.findCustomCandidates.mockResolvedValue([]);
  mocks.findDuelCandidates.mockResolvedValue([duelCandidate]);

  await expect(bindObservedLobby(mixedTeamLobbyObservation)).resolves.toBe(
    "unmatched",
  );

  expect(mocks.updateDuel).not.toHaveBeenCalled();
});

test("acknowledges an ambiguous lobby without binding either game", async () => {
  const unboundCandidate = {
    ...customCandidate,
    observedLobbyId: null,
    lobbyObservationId: null,
  };
  mocks.findCustomCandidates.mockResolvedValue([
    unboundCandidate,
    { ...unboundCandidate, id: "custom-game-2" },
  ]);

  await expect(bindObservedLobby(currentLobbyObservation)).resolves.toBe(
    "ambiguous",
  );

  expect(mocks.updateCustom).not.toHaveBeenCalled();
});

test("rebinds a recreated lobby while the scheduled game is still unstarted", async () => {
  mocks.findSupersedingLobby.mockResolvedValue({
    observationId: currentLobbyObservation.observationId,
  });

  await expect(bindObservedLobby(currentLobbyObservation)).resolves.toBe(
    "bound",
  );

  expect(mocks.updateCustom).toHaveBeenCalledWith({
    where: {
      id: "custom-game",
      state: "LOBBY_READY",
      observedLobbyId: "lobby-a",
      lobbyObservationId: "00000000-0000-4000-8000-000000000001",
    },
    data: {
      observedLobbyId: "current-lobby",
      lobbyObservationId: currentLobbyObservation.observationId,
    },
  });
});

test("refreshes custom binding evidence when players return to the same lobby", async () => {
  mocks.findCustomCandidates.mockResolvedValue([
    { ...customCandidate, observedLobbyId: currentLobbyObservation.lobbyId },
  ]);

  await expect(bindObservedLobby(currentLobbyObservation)).resolves.toBe(
    "bound",
  );

  expect(mocks.updateCustom).toHaveBeenCalledWith({
    where: {
      id: "custom-game",
      state: "LOBBY_READY",
      observedLobbyId: currentLobbyObservation.lobbyId,
      lobbyObservationId: "00000000-0000-4000-8000-000000000001",
    },
    data: {
      observedLobbyId: currentLobbyObservation.lobbyId,
      lobbyObservationId: currentLobbyObservation.observationId,
    },
  });
});

test("does not regress same-lobby binding evidence to an older observation", async () => {
  mocks.findCustomCandidates.mockResolvedValue([
    { ...customCandidate, observedLobbyId: currentLobbyObservation.lobbyId },
  ]);
  mocks.findLobbyObservation.mockResolvedValue({
    capturedAt: new Date("2026-09-20T12:45:00.000Z"),
  });

  await expect(bindObservedLobby(currentLobbyObservation)).resolves.toBe(
    "unmatched",
  );

  expect(mocks.updateCustom).not.toHaveBeenCalled();
});

test("does not revert a lobby binding with older delayed evidence", async () => {
  mocks.findLobbyObservation.mockResolvedValue({
    capturedAt: new Date("2026-09-20T12:45:00.000Z"),
  });
  mocks.findSupersedingLobby.mockResolvedValue({
    observationId: currentLobbyObservation.observationId,
  });

  await expect(bindObservedLobby(currentLobbyObservation)).resolves.toBe(
    "unmatched",
  );

  expect(mocks.updateCustom).not.toHaveBeenCalled();
});

test("rebinds a recreated duel lobby while its series is still unstarted", async () => {
  mocks.findCustomCandidates.mockResolvedValue([]);
  mocks.findDuelCandidates.mockResolvedValue([duelCandidate]);
  mocks.findSupersedingLobby.mockResolvedValue({
    observationId: currentLobbyObservation.observationId,
  });

  await expect(bindObservedLobby(currentLobbyObservation)).resolves.toBe(
    "bound",
  );

  expect(mocks.updateDuel).toHaveBeenCalledWith({
    where: {
      id: "duel-game",
      gameState: "code_ready",
      observedLobbyId: "lobby-a",
      lobbyObservationId: "00000000-0000-4000-8000-000000000001",
      series: { seriesState: "code_ready" },
    },
    data: {
      observedLobbyId: "current-lobby",
      lobbyObservationId: currentLobbyObservation.observationId,
    },
  });
});

test("refreshes duel binding evidence when players return to the same lobby", async () => {
  mocks.findCustomCandidates.mockResolvedValue([]);
  mocks.findDuelCandidates.mockResolvedValue([
    { ...duelCandidate, observedLobbyId: currentLobbyObservation.lobbyId },
  ]);

  await expect(bindObservedLobby(currentLobbyObservation)).resolves.toBe(
    "bound",
  );

  expect(mocks.updateDuel).toHaveBeenCalledWith({
    where: {
      id: "duel-game",
      gameState: "code_ready",
      observedLobbyId: currentLobbyObservation.lobbyId,
      lobbyObservationId: "00000000-0000-4000-8000-000000000001",
      series: { seriesState: "code_ready" },
    },
    data: {
      observedLobbyId: currentLobbyObservation.lobbyId,
      lobbyObservationId: currentLobbyObservation.observationId,
    },
  });
});

test("acknowledges an ambiguous post-game without binding either game", async () => {
  mocks.findCustomCandidates.mockResolvedValue([
    customCandidate,
    { ...customCandidate, id: "custom-game-2" },
  ]);

  await expect(bindObservedMatch(observation)).resolves.toBe("ambiguous");

  expect(mocks.updateCustom).not.toHaveBeenCalled();
});

test("acknowledges an ambiguous lifecycle projection without advancing either game", async () => {
  mocks.findCustomCandidates.mockResolvedValue([
    customCandidate,
    { ...customCandidate, id: "custom-game-2" },
  ]);

  await expect(projectObservedGameState(lifecycleObservation)).resolves.toBe(
    "ambiguous",
  );

  expect(mocks.transaction).not.toHaveBeenCalled();
});
