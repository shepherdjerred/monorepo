import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  LeaguePuuidSchema,
  PlayerConfigEntrySchema,
  type LeaguePuuid,
} from "@scout-for-lol/data/index.ts";
import type { PlayerAccountWithState } from "#src/database/index.ts";

// The guild a READY client still lists, and one it has dropped (a removal
// mid-match).
const LIVE_GUILD = "guild-live";
const REMOVED_GUILD = "guild-removed";

const SOURCE: LeaguePuuid = LeaguePuuidSchema.parse(
  "puuid-source".padEnd(78, "s"),
);
const TEAMMATE: LeaguePuuid = LeaguePuuidSchema.parse(
  "puuid-teammate".padEnd(78, "t"),
);

const mocks = vi.hoisted(() => ({
  accounts: new Map<string, PlayerAccountWithState>(),
  serverIdByPuuid: new Map<string, string>(),
  fetchMatchData: vi.fn(),
  processMatchAndUpdatePlayers: vi.fn(),
}));

// `getAccountsWithState` narrows by the guild set it is handed, exactly as the
// real query does, so a caller that passes the gateway set is caught here.
vi.mock("#src/database/index.ts", () => ({
  prisma: {},
  getAccountsWithState: (_client: unknown, activeServerIds?: Set<string>) =>
    Promise.resolve(
      [...mocks.accounts.entries()]
        .filter(
          ([puuid]) =>
            activeServerIds === undefined ||
            activeServerIds.has(mocks.serverIdByPuuid.get(puuid) ?? ""),
        )
        .map(([, account]) => account),
    ),
}));
// Answers as a READY client does, so a restored filter would narrow.
vi.mock("#src/discord/utils/guild-membership.ts", () => ({
  getActiveServerIds: () => new Set<string>([LIVE_GUILD]),
}));
vi.mock("#src/league/tasks/postmatch/match-data-fetcher.ts", () => ({
  fetchMatchData: mocks.fetchMatchData,
}));
vi.mock("#src/league/tasks/postmatch/match-history-polling.ts", () => ({
  processMatchAndUpdatePlayers: mocks.processMatchAndUpdatePlayers,
}));

const { ingestDiscoveredMatch, requireAuthoritativeMatchData } =
  await import("#src/league/tasks/postmatch/temporal-match-ingestion.ts");

function track(puuid: LeaguePuuid, serverId: string): void {
  const config = PlayerConfigEntrySchema.parse({
    alias: `alias-${puuid.slice(6, 12)}`,
    league: { leagueAccount: { puuid, region: "AMERICA_NORTH" } },
  });
  mocks.accounts.set(puuid, {
    config,
    lastMatchTime: undefined,
    lastCheckedAt: undefined,
  });
  mocks.serverIdByPuuid.set(puuid, serverId);
}

const intent = {
  matchId: "NA1_5000000001",
  sourcePuuid: SOURCE,
  region: "AMERICA_NORTH" as const,
  delivery: "live" as const,
};

const ProcessedMatchOptionsSchema = z.object({
  allPlayerConfigs: z.array(PlayerConfigEntrySchema),
});

function recordedPuuids(): LeaguePuuid[] {
  const [options] = mocks.processMatchAndUpdatePlayers.mock.calls[0] ?? [];
  return ProcessedMatchOptionsSchema.parse(options).allPlayerConfigs.map(
    (config) => config.league.leagueAccount.puuid,
  );
}

describe("Temporal match ingestion", () => {
  beforeEach(() => {
    mocks.accounts.clear();
    mocks.serverIdByPuuid.clear();
    mocks.fetchMatchData.mockReset();
    mocks.fetchMatchData.mockResolvedValue({ metadata: {}, info: {} });
    mocks.processMatchAndUpdatePlayers.mockReset();
    mocks.processMatchAndUpdatePlayers.mockResolvedValue(undefined);
  });

  test("keeps a missing authoritative match retryable", () => {
    expect(() =>
      requireAuthoritativeMatchData("NA1_UNAVAILABLE", undefined),
    ).toThrow("Authoritative match data is unavailable for NA1_UNAVAILABLE");
  });

  test("records every tracked account, not only the gateway cache's guilds", async () => {
    track(SOURCE, LIVE_GUILD);
    track(TEAMMATE, REMOVED_GUILD);

    await ingestDiscoveredMatch(intent);

    expect(mocks.processMatchAndUpdatePlayers).toHaveBeenCalledTimes(1);
    expect(recordedPuuids()).toEqual([SOURCE, TEAMMATE]);
  });

  test("still refuses a source account nobody tracks", async () => {
    track(TEAMMATE, LIVE_GUILD);

    await expect(ingestDiscoveredMatch(intent)).rejects.toThrow(
      `Tracked source account ${SOURCE} is unavailable for ${intent.matchId}`,
    );
    expect(mocks.fetchMatchData).not.toHaveBeenCalled();
    expect(mocks.processMatchAndUpdatePlayers).not.toHaveBeenCalled();
  });
});
