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
  },
}));

vi.mock("#src/customs/socket.ts", () => ({
  publishCustomNightSnapshot: vi.fn(),
}));

const { bindObservedMatch } = await import("./lobby-binding.ts");
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
  observedLobbyId: "lobby-a",
  lobbyObservationId: "00000000-0000-4000-8000-000000000001",
  participants: participantPuuids.map((puuid) => ({ puuid })),
};

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
