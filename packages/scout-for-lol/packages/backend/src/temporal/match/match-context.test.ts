import { beforeEach, expect, test, vi } from "vitest";
import { RawMatchSchema } from "@scout-for-lol/data";

const mocks = vi.hoisted(() => ({
  fetchMatchData: vi.fn(),
  getAccountsWithState: vi.fn(),
  getActiveServerIds: vi.fn(),
  readArchivedMatchPayload: vi.fn(),
  readSelectedLocalCanonicalMatch: vi.fn(),
  resolveLocalCanonicalMatch: vi.fn(),
  storedRawArchiveDescriptor: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {},
}));
vi.mock("#src/database/player-accounts.ts", () => ({
  getAccountsWithState: mocks.getAccountsWithState,
}));
vi.mock("#src/discord/utils/guild-membership.ts", () => ({
  getActiveServerIds: mocks.getActiveServerIds,
}));
vi.mock("#src/league/tasks/postmatch/match-data-fetcher.ts", () => ({
  fetchMatchData: mocks.fetchMatchData,
}));
vi.mock("#src/scout-client/canonical-match.ts", () => ({
  readSelectedLocalCanonicalMatch: mocks.readSelectedLocalCanonicalMatch,
  resolveLocalCanonicalMatch: mocks.resolveLocalCanonicalMatch,
}));
vi.mock("#src/report-lake/durable-receipts.ts", () => ({
  storedRawArchiveDescriptor: mocks.storedRawArchiveDescriptor,
}));
vi.mock("#src/report-lake/receipted-archive.ts", () => ({
  readArchivedMatchPayload: mocks.readArchivedMatchPayload,
}));

const { resolveScoutMatchContext } = await import("./match-context.ts");
const fixture = RawMatchSchema.parse(
  await Bun.file("../../testdata/rift.json").json(),
);
const riotMatchId = fixture.metadata.matchId;
const trackedPuuid = fixture.metadata.participants[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveServerIds.mockReturnValue([]);
  mocks.getAccountsWithState.mockResolvedValue([
    {
      config: {
        alias: "tracked",
        league: {
          leagueAccount: {
            puuid: trackedPuuid,
            region: "AMERICA_NORTH",
          },
        },
      },
    },
  ]);
  mocks.storedRawArchiveDescriptor.mockResolvedValue(null);
  mocks.readSelectedLocalCanonicalMatch.mockResolvedValue(null);
  mocks.resolveLocalCanonicalMatch.mockResolvedValue(null);
  mocks.fetchMatchData.mockResolvedValue(fixture);
});

test("reuses an archived canonical match while retaining its source provenance", async () => {
  const descriptor = { key: "canonical-match" };
  mocks.storedRawArchiveDescriptor.mockResolvedValue(descriptor);
  mocks.readArchivedMatchPayload.mockResolvedValue(fixture);

  const context = await resolveScoutMatchContext(riotMatchId);

  expect(context.matchData).toBe(fixture);
  expect(context.matchDataSource).toBe("RIOT");
  expect(mocks.readArchivedMatchPayload).toHaveBeenCalledWith(
    descriptor,
    riotMatchId,
  );
  expect(mocks.readSelectedLocalCanonicalMatch).toHaveBeenCalledWith(
    riotMatchId,
  );
  expect(mocks.fetchMatchData).not.toHaveBeenCalled();
  expect(mocks.resolveLocalCanonicalMatch).not.toHaveBeenCalled();
});

test("retains local provenance after the selected payload is archived", async () => {
  const descriptor = { key: "canonical-match" };
  mocks.storedRawArchiveDescriptor.mockResolvedValue(descriptor);
  mocks.readArchivedMatchPayload.mockResolvedValue(fixture);
  mocks.readSelectedLocalCanonicalMatch.mockResolvedValue(fixture);

  const context = await resolveScoutMatchContext(riotMatchId);

  expect(context.matchData).toBe(fixture);
  expect(context.matchDataSource).toBe("SCOUT_CLIENT");
  expect(mocks.fetchMatchData).not.toHaveBeenCalled();
  expect(mocks.resolveLocalCanonicalMatch).not.toHaveBeenCalled();
});

test("uses local evidence only after Riot definitively lacks the match", async () => {
  mocks.fetchMatchData.mockResolvedValue(undefined);
  mocks.resolveLocalCanonicalMatch.mockResolvedValue(fixture);

  const context = await resolveScoutMatchContext(riotMatchId);

  expect(context.matchData).toBe(fixture);
  expect(context.matchDataSource).toBe("SCOUT_CLIENT");
  expect(mocks.fetchMatchData).toHaveBeenCalledWith(
    riotMatchId,
    "NA1",
    "return_undefined_on_404",
  );
  expect(mocks.resolveLocalCanonicalMatch).toHaveBeenCalledWith(riotMatchId);
});

test("propagates a retryable Riot failure before selecting local evidence", async () => {
  const failure = new Error("temporary Riot failure");
  mocks.fetchMatchData.mockRejectedValue(failure);
  mocks.resolveLocalCanonicalMatch.mockResolvedValue(fixture);

  await expect(resolveScoutMatchContext(riotMatchId)).rejects.toBe(failure);

  expect(mocks.resolveLocalCanonicalMatch).not.toHaveBeenCalled();
});
