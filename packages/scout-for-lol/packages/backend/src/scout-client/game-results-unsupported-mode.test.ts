import { beforeEach, expect, test, vi } from "vitest";
import {
  LeaguePuuidSchema,
  ScoutClientObservationSchema,
} from "@scout-for-lol/data";

const mocks = vi.hoisted(() => ({
  findUniqueOrThrow: vi.fn(),
  findFirst: vi.fn(),
  upsert: vi.fn(),
  admit: vi.fn(),
  project: vi.fn(),
}));
vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientObservation: {
      findUniqueOrThrow: mocks.findUniqueOrThrow,
      findFirst: mocks.findFirst,
    },
    scoutClientGameResult: { upsert: mocks.upsert },
  },
}));
vi.mock("#src/configuration/flags.ts", () => ({
  isFeatureHardDisabled: () => false,
}));
vi.mock("#src/evidence/admission.ts", () => ({
  admitMatchEvidence: mocks.admit,
}));
vi.mock("#src/evidence/result-projection.ts", () => ({
  projectResultEvidence: mocks.project,
}));

const { projectClientGameResult } = await import("./game-results.ts");

const puuid = LeaguePuuidSchema.parse("p".repeat(78));

function postGame(data: unknown) {
  return ScoutClientObservationSchema.parse({
    protocolVersion: 1,
    schemaVersion: 1,
    observationId: crypto.randomUUID(),
    sequence: 1,
    capturedAt: new Date().toISOString(),
    appVersion: "0.1.0",
    kind: "post_game",
    platformId: "NA1",
    localPuuid: puuid,
    gameId: "7101",
    payload: { resource: "post_game", data },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUniqueOrThrow.mockResolvedValue({
    receivedAt: new Date(),
    deviceId: "device",
  });
  mocks.findFirst.mockResolvedValue(null);
});

test("an Arena end-of-game statsBlock without teams projects to unsupported_mode", async () => {
  await expect(
    projectClientGameResult(
      postGame({ gameMode: "CHERRY", statsBlock: { players: [] } }),
    ),
  ).resolves.toBe("unsupported_mode");

  expect(mocks.upsert).not.toHaveBeenCalled();
  expect(mocks.admit).not.toHaveBeenCalled();
});

test("an end-of-game block that states no queue is Arena by its gameflow context", async () => {
  mocks.findFirst.mockResolvedValue({
    payload: {
      data: { gameData: { queue: { id: 1740, gameMode: "CHERRY" } } },
    },
  });

  await expect(
    projectClientGameResult(postGame({ statsBlock: { players: [] } })),
  ).resolves.toBe("unsupported_mode");

  expect(mocks.upsert).not.toHaveBeenCalled();
});

test("another mode's unparseable block is skipped, not terminal", async () => {
  mocks.findFirst.mockResolvedValue({
    payload: {
      data: { gameData: { queue: { id: 420, gameMode: "CLASSIC" } } },
    },
  });

  await expect(
    projectClientGameResult(postGame({ statsBlock: { players: [] } })),
  ).resolves.toBe("skipped");
});
