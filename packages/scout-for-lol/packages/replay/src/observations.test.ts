import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  binding: vi.fn(),
  levels: vi.fn(),
  returns: vi.fn(),
  turrets: vi.fn(),
  sides: vi.fn(),
  structures: vi.fn(),
  sampler: vi.fn(),
  TurretError: class extends Error {},
}));
vi.mock("./observations/transport.mjs", () => ({ openReplay: mocks.open }));
vi.mock("./observations/replay-participant-bindings.mjs", () => ({
  verifyReplayParticipantBindings: mocks.binding,
}));
vi.mock("./observations/replay-actor-levels.mjs", () => ({
  createReplayActorLevelObserver: mocks.levels,
}));
vi.mock("./observations/replay-actor-state.mjs", () => ({
  createReplayActorStateSampler: mocks.sampler,
}));
vi.mock("./observations/replay-champion-lifecycle.mjs", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createChampionReturnObserver: mocks.returns,
}));
vi.mock("./observations/replay-turret-events.mjs", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ReplayTurretValidationError: mocks.TurretError,
  createReplayTurretObserver: mocks.turrets,
}));
vi.mock("./observations/replay-turret-sides.mjs", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createReplayTurretSideObserver: mocks.sides,
}));
vi.mock("./observations/replay-structure-events.mjs", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createReplayStructureObserver: mocks.structures,
}));

const { decodeReplayObservations, createReplayObservationActorSampler } =
  await import("./observations.ts");
const bytes = new ArrayBuffer(4);
const decompress = vi.fn((stored: Uint8Array) => stored);
const replay = {
  build: "16.23.840.6595",
  protocol: "8bbfcd5af2bc92db",
  duration: 60,
  roster: [{ champion: "Champion", team: 100 }],
  participantSummonerIds: ["private-summoner-key"],
  playerIdentities: [{ gameName: "private-name" }],
};
const binding = {
  verified: [{ context: 1, footerRow: 1 }],
  unresolved: [],
  assistEvents: 1,
  assists: [
    {
      kind: "champion-assist",
      context: 1,
      partition: 0,
      timeSeconds: 1,
      secondTimeBits: 123,
    },
  ],
  events: [],
};
function observer(value: unknown) {
  return { observeGameplayPacket: vi.fn(), finish: vi.fn(() => value) };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.open.mockReturnValue(replay);
  mocks.binding.mockImplementation((_replay, _decompress, target) => {
    target?.observeGameplayPacket({ originalPacket: true }, 1011, 1);
    return binding;
  });
  mocks.levels.mockReturnValue(
    observer({ initialLevel: 1, events: [], finalLevels: [] }),
  );
  mocks.returns.mockReturnValue(observer([]));
  mocks.turrets.mockReturnValue(observer([]));
  mocks.sides.mockReturnValue(observer([]));
  mocks.structures.mockReturnValue(observer([]));
  mocks.sampler.mockReturnValue(() => [{ partition: 0, dead: false }]);
});

test("the public pure entrypoint uses one shared scan, keeps assists and omits private footer identities", () => {
  const result = decodeReplayObservations(bytes, decompress);
  expect(mocks.binding).toHaveBeenCalledOnce();
  expect(mocks.binding).toHaveBeenCalledWith(
    replay,
    decompress,
    expect.any(Object),
  );
  expect(result.binding.assists).toEqual(binding.assists);
  expect(result).not.toHaveProperty("participantSummonerIds");
  expect(result).not.toHaveProperty("playerIdentities");
  expect(JSON.stringify(result)).not.toContain("private-");
  expect(bytes.byteLength).toBe(4);
  const sampler = createReplayObservationActorSampler(result);
  expect(sampler(0)).toEqual([{ partition: 0, dead: false }]);
});

test("typed optional turret evidence failures do not discard verified lifecycle facts", () => {
  mocks.turrets.mockImplementation(() => {
    throw new mocks.TurretError("unavailable");
  });
  const result = decodeReplayObservations(bytes, decompress);
  expect(result.turrets).toBeNull();
  expect(result.structures).toBeNull();
  expect(result.returns).toEqual([]);
  expect(result.aliveCounts).toEqual([{ timestampMs: 0, teamA: 1, teamB: 0 }]);
  mocks.turrets.mockImplementation(() => {
    throw new SyntaxError("invalid footer JSON");
  });
  expect(() => decodeReplayObservations(bytes, decompress)).toThrow(
    "invalid footer JSON",
  );
});

test("explicit combat-only mode creates no optional lifecycle observers", () => {
  const result = decodeReplayObservations(bytes, decompress, {
    lifecycle: false,
  });
  expect(mocks.levels).not.toHaveBeenCalled();
  expect(mocks.returns).not.toHaveBeenCalled();
  expect(result.levels).toBeNull();
  expect(result.aliveCounts).toBeNull();
  expect(() =>
    Reflect.apply(decodeReplayObservations, undefined, [bytes, undefined]),
  ).toThrow("decompressor");
});
