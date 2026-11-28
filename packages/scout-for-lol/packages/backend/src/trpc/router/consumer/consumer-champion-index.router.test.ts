import { describe, expect, test, vi } from "vitest";
import { createChampionPageTestEnv } from "#src/testing/consumer-champion-test-env.ts";
import { expectOneLakeSlot } from "#src/testing/consumer-profile-feature-test.ts";
import type * as AccessModule from "#src/consumer/access.ts";
import { writeTestLake } from "#src/testing/report-lake/test-report-lake.ts";
import {
  AHRI,
  HOURS,
  NOW,
  RIVER,
  TIDAL,
  VIEWER_ALT,
  VIEWER_MAIN,
  JINX,
  groupGames,
  soloGame,
} from "#src/testing/consumer-champion-group.ts";

// A Discord lookup that cannot answer is not a denial.
const discord = vi.hoisted(() => ({ unavailable: false }));
vi.mock("#src/consumer/access.ts", async () => {
  const actual: typeof AccessModule = await vi.importActual(
    "#src/consumer/access.ts",
  );
  return {
    ...actual,
    resolveConsumerGuildAccess: (
      ...args: Parameters<typeof actual.resolveConsumerGuildAccess>
    ) =>
      discord.unavailable
        ? Promise.resolve({ kind: "unavailable" as const })
        : actual.resolveConsumerGuildAccess(...args),
  };
});

const {
  guildId,
  otherGuildId,
  lakeDir,
  profileFeature,
  trpc,
  caller,
  seedGroup,
  seedPlayer,
  writeLobbies,
} = await createChampionPageTestEnv("trpc-consumer-champion-index", {
  onPrepare: () => {
    discord.unavailable = false;
  },
});

describe("champion pages: access", () => {
  const requests = {
    index: () => caller().consumerChampion.index({}),
    matchups: () =>
      caller().consumerChampion.matchups({
        championId: AHRI.id,
        lane: "middle",
      }),
    compare: () => caller().consumerChampion.compare({ championId: AHRI.id }),
  };

  test("a server without the rollout is forbidden, not unavailable", async () => {
    for (const request of Object.values(requests)) {
      await expect(request()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("a server that cannot be confirmed is unavailable, not forbidden", async () => {
    profileFeature.enable(guildId);
    discord.unavailable = true;
    for (const request of Object.values(requests)) {
      await expect(request()).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
      });
    }
  });

  test("a requested server outside the viewer's scope is forbidden", async () => {
    profileFeature.enable(guildId);
    await expect(
      caller().consumerChampion.index({ guildIds: [otherGuildId] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().consumerChampion.matchups({
        championId: AHRI.id,
        lane: "middle",
        guildIds: [otherGuildId],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("a caller with no session is rejected", async () => {
    profileFeature.enable(guildId);
    await expect(
      trpc.anonCaller().consumerChampion.index({}),
    ).rejects.toThrow();
  });
});

describe("champion pages: no games", () => {
  test("an empty lake answers empty lists, not errors", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    const index = await caller().consumerChampion.index({});
    expect(index.champions).toEqual([]);
    expect(index.availableGuilds).toEqual([{ guildId, name: "test-guild" }]);
    await expect(
      caller().consumerChampion.matchups({
        championId: AHRI.id,
        lane: "middle",
      }),
    ).resolves.toMatchObject({ matchups: [] });
    await expect(
      caller().consumerChampion.compare({ championId: AHRI.id }),
    ).resolves.toMatchObject({ rows: [] });
  });

  test("a viewer with no player in scope still sees their friends", async () => {
    profileFeature.enable(guildId);
    await seedPlayer({
      serverId: guildId,
      alias: "RiverQuartz",
      puuids: [RIVER],
    });
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [
        soloGame({ n: 1, hoursAgo: 1, puuid: RIVER, champion: AHRI }),
      ],
    });
    const index = await caller().consumerChampion.index({});
    expect(index.champions[0]).toMatchObject({
      championId: AHRI.id,
      games: 1,
      friendCount: 1,
      you: null,
    });
  });
});

describe("consumerChampion.index", () => {
  test("counts a person once across accounts and servers", async () => {
    profileFeature.enable(guildId, otherGuildId);
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);
    await seedGroup();
    await writeLobbies(groupGames());

    const both = await caller().consumerChampion.index({});
    const ahri = both.champions.find((entry) => entry.championId === AHRI.id);
    // Main, alt and the other server's account are one viewer: four Ahri
    // games (1h, 2h, 7h, 8h), won three.
    expect(ahri?.you).toEqual({
      games: 4,
      wins: 3,
      winRate: 0.75,
      lastPlayedMs: NOW - HOURS,
    });
    // River (2 games, 1 win) and Tidal (1 game, 1 win) add three games, two wins.
    expect(ahri).toMatchObject({
      name: "Ahri",
      games: 7,
      wins: 5,
      friendCount: 2,
      lanes: [
        { lane: "middle", games: 6 },
        { lane: "top", games: 1 },
      ],
      lastPlayedMs: NOW - HOURS,
      publicMeta: null,
    });

    const one = await caller().consumerChampion.index({ guildIds: [guildId] });
    const ahriInOne = one.champions.find(
      (entry) => entry.championId === AHRI.id,
    );
    expect(ahriInOne?.you?.games).toBe(3);
    expect(ahriInOne?.friendCount).toBe(2);
  });

  test("ranks the best friend among those with enough games, else flags the sample", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeLobbies(groupGames());
    const summary = await caller().consumerChampion.index({});
    const ahri = summary.champions.find(
      (entry) => entry.championId === AHRI.id,
    );
    // Tidal won her one game; River won one of two. Nobody has 10 games.
    expect(ahri?.bestFriend).toMatchObject({
      alias: "TidalWren",
      games: 1,
      wins: 1,
      winRate: 1,
      qualified: false,
    });

    const many = Array.from({ length: 10 }, (_, index) =>
      soloGame({
        n: 100 + index,
        hoursAgo: 20 + index,
        puuid: RIVER,
        champion: AHRI,
        win: index < 6,
      }),
    );
    await writeTestLake(lakeDir, { serverId: guildId, matchFacts: many });
    const wider = await caller().consumerChampion.index({ games: 50 });
    expect(wider.champions[0]?.bestFriend).toMatchObject({
      alias: "RiverQuartz",
      // Ten more games plus the two from the group's lobbies.
      games: 12,
      wins: 7,
      qualified: true,
    });
  });

  test("orders by games, then friends, then name, and never reorders on a re-read", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [
        soloGame({ n: 1, hoursAgo: 1, puuid: VIEWER_MAIN, champion: JINX }),
        soloGame({
          n: 2,
          hoursAgo: 2,
          puuid: RIVER,
          champion: { id: 99, name: "Lux" },
        }),
        soloGame({
          n: 3,
          hoursAgo: 3,
          puuid: TIDAL,
          champion: { id: 22, name: "Ashe" },
        }),
        soloGame({
          n: 4,
          hoursAgo: 4,
          puuid: TIDAL,
          champion: { id: 1, name: "Annie" },
        }),
        soloGame({ n: 5, hoursAgo: 5, puuid: RIVER, champion: AHRI }),
        soloGame({ n: 6, hoursAgo: 6, puuid: TIDAL, champion: AHRI }),
        soloGame({ n: 7, hoursAgo: 7, puuid: VIEWER_ALT, champion: AHRI }),
      ],
    });
    const first = await caller().consumerChampion.index({});
    expect(first.champions.map((entry) => entry.name)).toEqual([
      "Ahri",
      "Annie",
      "Ashe",
      "Lux",
      "Jinx",
    ]);
    expect(await caller().consumerChampion.index({})).toEqual(first);
    // The newest-N window applies per person across champions.
    const window = await caller().consumerChampion.index({ games: 20 });
    expect(window.champions).toEqual(first.champions);
  });
});

describe("champion pages: one lake slot per request", () => {
  test("each page read opens exactly one DuckDB connection", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeLobbies(groupGames());
    const requests: (() => Promise<unknown>)[] = [
      () => caller().consumerChampion.index({}),
      () =>
        caller().consumerChampion.matchups({
          championId: AHRI.id,
          lane: "middle",
        }),
      () => caller().consumerChampion.compare({ championId: AHRI.id }),
    ];
    for (const request of requests) {
      await expectOneLakeSlot(request);
    }
  });
});
