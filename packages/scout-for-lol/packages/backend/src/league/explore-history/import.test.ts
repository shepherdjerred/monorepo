import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  RawMatchSchema,
  RiotMatchIdSchema,
  type RawMatch,
  type RiotMatchId,
} from "@scout-for-lol/data";
import { ScoutExploreHistoryInputSchema } from "@scout-for-lol/temporal";
import { testPuuid } from "#src/testing/test-ids.ts";

const puuid = testPuuid("explore-history");

const fixture = RawMatchSchema.parse(
  await Bun.file(
    new URL(
      "../model/__tests__/testdata/matches_2025_09_19_NA1_5370986469.json",
      import.meta.url,
    ),
  ).json(),
);
const ids = Array.from({ length: 12 }, (_, index) =>
  RiotMatchIdSchema.parse(`NA1_${(index + 1).toString()}`),
);
const list = vi.fn(() => Promise.resolve(ids));
const knownRows = [{ match_id: ids[0] }];
let active = 0;
let peak = 0;
const fetchMatch = vi.fn(
  async ({ matchId }: { matchId: RiotMatchId }): Promise<RawMatch | null> => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    if (matchId === ids.at(-1)) return null;
    return RawMatchSchema.parse({
      ...fixture,
      metadata: { ...fixture.metadata, matchId },
    });
  },
);
const store = vi.fn(() => Promise.resolve({ stored: true, staged: true }));
vi.doMock("#src/league/api/api.ts", () => ({
  riotClient: { match: { list } },
}));
vi.doMock("#src/league/initial-history/riot.ts", () => ({
  fetchInitialMatch: fetchMatch,
}));
vi.doMock("#src/report-store/live-ingest.ts", () => ({
  recordMatchForReportStore: store,
}));
vi.doMock("#src/reports/duckdb/instance.ts", () => ({
  withDuckDBConnection: (
    work: (session: {
      run: () => Promise<typeof knownRows>;
    }) => Promise<unknown>,
  ) => work({ run: () => Promise.resolve(knownRows) }),
}));
vi.doMock("#src/reports/duckdb/lake-reads.ts", () => ({
  bindParams: () => [],
}));
vi.doMock("#src/reports/duckdb/lake.ts", () => ({
  withLakeQueryRetry: (
    _dir: string,
    work: (files: object) => Promise<unknown>,
  ) => work({}),
  buildMatchesSource: () => ({ sql: "known matches", params: [] }),
  listParam: (values: unknown) => values,
}));
const { importExploreRankedHistory } = await import("./import.ts");

beforeEach(() => {
  vi.clearAllMocks();
  active = 0;
  peak = 0;
});

describe("on-demand match acquisition", () => {
  test.each([undefined, "ranked", "normal"] as const)(
    "imports %s history with reuse and bounded Riot reads",
    async (matchType) => {
      const input = ScoutExploreHistoryInputSchema.parse({
        stage: "dev",
        puuid,
        region: "AMERICA_NORTH",
        acquisitionBucket: 123,
        ...(matchType === undefined ? {} : { matchType }),
      });
      expect(await importExploreRankedHistory(input)).toEqual({
        requested: 100,
        found: 12,
        alreadyAvailable: 1,
        ingested: 10,
        skipped: 1,
      });
      expect(list).toHaveBeenCalledWith(
        puuid,
        "AMERICAS",
        { count: 100, type: matchType ?? "ranked" },
        { maxRetries: 0 },
      );
      expect(fetchMatch).toHaveBeenCalledTimes(11);
      expect(
        fetchMatch.mock.calls.some(([call]) => call.matchId === ids[0]),
      ).toBe(false);
      expect(store).toHaveBeenCalledTimes(10);
      expect(peak).toBeLessThanOrEqual(5);
    },
  );

  test("rejects oversized imports before reaching Riot", async () => {
    await expect(
      importExploreRankedHistory({
        stage: "dev",
        puuid,
        region: "AMERICA_NORTH",
        acquisitionBucket: 123,
        requestedMatches: 101,
        matchType: "normal",
      }),
    ).rejects.toThrow();
    expect(list).not.toHaveBeenCalled();
  });

  test("an unstaged match fails the import instead of reporting ready", async () => {
    store.mockResolvedValueOnce({ stored: true, staged: false });
    await expect(
      importExploreRankedHistory({
        stage: "dev",
        puuid,
        region: "AMERICA_NORTH",
        acquisitionBucket: 123,
        requestedMatches: 100,
        matchType: "normal",
      }),
    ).rejects.toThrow("was not stored and staged");
  });
});
