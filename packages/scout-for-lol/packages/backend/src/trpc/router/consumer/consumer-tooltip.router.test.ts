import { beforeEach, describe, expect, test, vi } from "vitest";
import { PlayerIdSchema } from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  createChampionPageTestEnv,
  discordAccessMock,
} from "#src/testing/consumer-champion-test-env.ts";
import type * as AccessModule from "#src/consumer/access.ts";
import { expectOneLakeSlot } from "#src/testing/consumer-profile-feature-test.ts";
import { writeTestLake } from "#src/testing/report-lake/test-report-lake.ts";
import {
  AHRI,
  HOURS,
  NOW,
  RIVER,
  TIDAL,
  VIEWER_ALT,
  VIEWER_MAIN,
  VIEWER_OTHER_GUILD,
  JINX,
  groupGames,
  lobby,
  soloGame,
} from "#src/testing/consumer-champion-group.ts";

// A Discord lookup that cannot answer is not a denial.
const discord = vi.hoisted(() => ({ unavailable: false }));
vi.mock("#src/consumer/access.ts", async () =>
  discordAccessMock(
    discord,
    await vi.importActual<typeof AccessModule>("#src/consumer/access.ts"),
  ),
);

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
} = await createChampionPageTestEnv("trpc-consumer-tooltip", {
  onPrepare: () => {
    discord.unavailable = false;
  },
});
const { prisma } = trpc;

const DAY = 24 * HOURS;

beforeEach(async () => {
  await prisma.currentRankSnapshot.deleteMany();
  await prisma.matchRankHistory.deleteMany();
});

/** The viewer has no player in scope; River is the only tracked player. */
async function riverAlone() {
  const river = await seedPlayer({
    serverId: guildId,
    alias: "RiverQuartz",
    puuids: [RIVER],
  });
  await writeLobbies(
    [],
    [soloGame({ n: 1, hoursAgo: 1, puuid: RIVER, champion: AHRI })],
  );
  return river;
}

function ahriFacts() {
  return caller().consumerTooltip.facts({
    kind: "champion",
    championId: AHRI.id,
  });
}

function playerFacts(playerId: number) {
  return caller().consumerTooltip.facts({
    kind: "player",
    playerId: PlayerIdSchema.parse(playerId),
  });
}

function seat(
  who: typeof VIEWER_MAIN,
  team: 100 | 200,
  position: "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM",
) {
  return {
    who,
    team,
    position,
    champion: position === "MIDDLE" ? AHRI : JINX,
    gold15: 5000,
  };
}

/**
 * Games the viewer and River shared, newest first: 10h a win on the main
 * account, 11h a loss on the alt, 12h a win on the other server's account,
 * 13h a win with both of the viewer's accounts and River, 14h against each
 * other (not together), and 15h a win with Tidal, not River.
 */
function sharedGames() {
  return [
    lobby({
      n: 21,
      hoursAgo: 10,
      winner: 100,
      seats: [seat(VIEWER_MAIN, 100, "TOP"), seat(RIVER, 100, "JUNGLE")],
    }),
    lobby({
      n: 22,
      hoursAgo: 11,
      winner: 200,
      seats: [seat(VIEWER_ALT, 100, "TOP"), seat(RIVER, 100, "JUNGLE")],
    }),
    lobby({
      n: 23,
      hoursAgo: 12,
      winner: 100,
      seats: [seat(VIEWER_OTHER_GUILD, 100, "TOP"), seat(RIVER, 100, "JUNGLE")],
    }),
    lobby({
      n: 24,
      hoursAgo: 13,
      winner: 100,
      seats: [
        seat(VIEWER_MAIN, 100, "TOP"),
        seat(VIEWER_ALT, 100, "MIDDLE"),
        seat(RIVER, 100, "JUNGLE"),
      ],
    }),
    lobby({
      n: 25,
      hoursAgo: 14,
      winner: 100,
      seats: [seat(VIEWER_MAIN, 100, "TOP"), seat(RIVER, 200, "TOP")],
    }),
    lobby({
      n: 26,
      hoursAgo: 15,
      winner: 100,
      seats: [seat(VIEWER_MAIN, 100, "TOP"), seat(TIDAL, 100, "JUNGLE")],
    }),
  ];
}

function enableBoth() {
  profileFeature.enable(guildId, otherGuildId);
  trpc.setMembership([
    { guildId, asAdmin: false },
    { guildId: otherGuildId, asAdmin: false },
  ]);
}

describe("consumerTooltip.facts: access", () => {
  test("a server without the rollout is forbidden, not unavailable", async () => {
    await expect(ahriFacts()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(playerFacts(1)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("a server that cannot be confirmed is unavailable, not forbidden", async () => {
    profileFeature.enable(guildId);
    discord.unavailable = true;
    await expect(ahriFacts()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    await expect(playerFacts(1)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  test("a caller with no session is rejected", async () => {
    profileFeature.enable(guildId);
    await expect(
      trpc.anonCaller().consumerTooltip.facts({
        kind: "champion",
        championId: AHRI.id,
      }),
    ).rejects.toThrow();
  });

  test("a player outside the viewer's servers is not found", async () => {
    profileFeature.enable(guildId, otherGuildId);
    const { viewerElsewhere } = await seedGroup();
    const stranger = await seedPlayer({
      serverId: otherGuildId,
      alias: "Elsewhere",
      puuids: [TIDAL],
    });
    await expect(playerFacts(stranger.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // The viewer's own row in that server is outside scope too.
    await expect(playerFacts(viewerElsewhere.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(playerFacts(999_999)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("consumerTooltip.facts: champion", () => {
  test("answers the viewer's record and their friends' combined record", async () => {
    enableBoth();
    await seedGroup();
    await writeLobbies(groupGames());
    const facts = await ahriFacts();
    // Main, alt and the other server's account are one viewer: four games
    // (1h, 2h, 7h, 8h), won three. River has two (won one), Tidal one (won).
    expect(facts).toEqual({
      kind: "champion",
      champion: { championId: AHRI.id, name: "Ahri" },
      windowDays: 90,
      you: { games: 4, wins: 3, winRate: 0.75 },
      friends: {
        players: 2,
        games: 3,
        wins: 2,
        best: {
          playerId: expect.any(Number),
          alias: "TidalWren",
          games: 1,
          wins: 1,
          winRate: 1,
          lowSample: true,
        },
      },
    });
  });

  test("counts only the last 90 days", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [
        soloGame({
          n: 1,
          hoursAgo: 89 * 24,
          puuid: VIEWER_MAIN,
          champion: AHRI,
        }),
        soloGame({
          n: 2,
          hoursAgo: 91 * 24,
          puuid: VIEWER_MAIN,
          champion: AHRI,
        }),
        soloGame({ n: 3, hoursAgo: 365 * 24, puuid: RIVER, champion: AHRI }),
      ],
    });
    const facts = await ahriFacts();
    expect(facts.kind === "champion" && facts.you).toMatchObject({ games: 1 });
    expect(facts.kind === "champion" && facts.friends).toBeNull();
  });

  test("a champion nobody played has no record", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeLobbies(groupGames());
    const facts = await caller().consumerTooltip.facts({
      kind: "champion",
      championId: 555,
    });
    expect(facts).toMatchObject({ you: null, friends: null });
  });

  test("a viewer with no player in scope still sees their friends", async () => {
    profileFeature.enable(guildId);
    await riverAlone();
    expect(await ahriFacts()).toMatchObject({
      you: null,
      friends: { players: 1, games: 1, wins: 1 },
    });
  });

  test("the page's queue filter narrows the record", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeLobbies(groupGames());
    const facts = await caller().consumerTooltip.facts({
      kind: "champion",
      championId: AHRI.id,
      queues: ["arena"],
    });
    expect(facts).toMatchObject({ you: null, friends: null });
  });

  test("takes one lake slot and never reorders on a re-read", async () => {
    enableBoth();
    await seedGroup();
    await writeLobbies(groupGames());
    const first = await expectOneLakeSlot(ahriFacts);
    expect(await ahriFacts()).toEqual(first);
  });
});

describe("consumerTooltip.facts: player", () => {
  test("answers rank, the latest game and the games together", async () => {
    enableBoth();
    const { river } = await seedGroup();
    await writeLobbies([...groupGames(), ...sharedGames()]);
    await prisma.matchRankHistory.create({
      data: {
        matchId: RiotMatchIdSchema.parse("NA1_9100000080"),
        puuid: RIVER,
        queueType: "solo",
        rankAfter: JSON.stringify({
          tier: "silver",
          division: 1,
          lp: 20,
          wins: 8,
          losses: 7,
        }),
        capturedAt: new Date(NOW - 5 * DAY),
      },
    });
    await prisma.currentRankSnapshot.create({
      data: {
        puuid: RIVER,
        soloRank: JSON.stringify({
          tier: "emerald",
          division: 1,
          lp: 22,
          wins: 80,
          losses: 70,
        }),
        flexRank: JSON.stringify({
          tier: "gold",
          division: 2,
          lp: 60,
          wins: 30,
          losses: 30,
        }),
        fetchedAt: new Date(NOW - DAY),
      },
    });

    const facts = await expectOneLakeSlot(() => playerFacts(river.id));
    // Together: 10h, 11h, 12h and 13h (the viewer's two accounts in one game
    // count once), won three. 14h was against each other, 15h with Tidal.
    expect(facts).toEqual({
      kind: "player",
      player: {
        playerId: river.id,
        alias: "RiverQuartz",
        isViewer: false,
        guilds: [{ guildId, name: "test-guild" }],
      },
      windowDays: 90,
      rank: { queue: "solo", tier: "emerald", division: 1, leaguePoints: 22 },
      latestGame: expect.objectContaining({
        championName: "Ahri",
        win: true,
        gameCreationMs: expect.any(Number),
      }),
      together: { games: 4, wins: 3, results: [true, false, true, true] },
    });
  });

  test("falls back to Flex, and to no rank", async () => {
    profileFeature.enable(guildId);
    const { river, tidal } = await seedGroup();
    await prisma.currentRankSnapshot.create({
      data: {
        puuid: TIDAL,
        soloRank: null,
        flexRank: JSON.stringify({
          tier: "gold",
          division: 2,
          lp: 60,
          wins: 30,
          losses: 30,
        }),
        fetchedAt: new Date(NOW),
      },
    });
    expect(await playerFacts(tidal.id)).toMatchObject({
      rank: { queue: "flex", tier: "gold", division: 2, leaguePoints: 60 },
    });
    expect(await playerFacts(river.id)).toMatchObject({
      rank: null,
      latestGame: null,
      together: null,
    });
  });

  test("the viewer's own tooltip has no games together, from either server", async () => {
    enableBoth();
    const { viewer, viewerElsewhere } = await seedGroup();
    await writeLobbies([...groupGames(), ...sharedGames()]);
    const own = await playerFacts(viewer.id);
    expect(own).toMatchObject({
      player: {
        playerId: viewer.id,
        isViewer: true,
        guilds: [
          { guildId, name: "test-guild" },
          { guildId: otherGuildId, name: expect.any(String) },
        ],
      },
      together: null,
    });
    // The same person through their row in the other server.
    expect(await playerFacts(viewerElsewhere.id)).toEqual(own);
  });

  test("games together are bounded to 90 days and to ordinary queues", async () => {
    profileFeature.enable(guildId);
    const { river } = await seedGroup();
    await writeLobbies([
      lobby({
        n: 31,
        hoursAgo: 91 * 24,
        winner: 100,
        seats: [seat(VIEWER_MAIN, 100, "TOP"), seat(RIVER, 100, "JUNGLE")],
      }),
      lobby({
        n: 32,
        hoursAgo: 5,
        winner: 100,
        seats: [seat(VIEWER_MAIN, 100, "TOP"), seat(RIVER, 100, "JUNGLE")],
      }),
    ]);
    expect(await playerFacts(river.id)).toMatchObject({
      together: { games: 1, wins: 1, results: [true] },
    });
  });

  test("lists at most the ten newest results, newest first", async () => {
    profileFeature.enable(guildId);
    const { river } = await seedGroup();
    await writeLobbies(
      Array.from({ length: 12 }, (_, index) =>
        lobby({
          n: 40 + index,
          hoursAgo: 1 + index,
          winner: index === 0 ? 200 : 100,
          seats: [seat(VIEWER_MAIN, 100, "TOP"), seat(RIVER, 100, "JUNGLE")],
        }),
      ),
    );
    const facts = await playerFacts(river.id);
    expect(facts.kind === "player" && facts.together).toEqual({
      games: 12,
      wins: 11,
      results: [false, ...Array.from({ length: 9 }, () => true)],
    });
    expect(await playerFacts(river.id)).toEqual(facts);
  });

  test("a viewer with no player in scope has no games together", async () => {
    profileFeature.enable(guildId);
    const river = await riverAlone();
    expect(await playerFacts(river.id)).toMatchObject({
      latestGame: { championName: "Ahri" },
      together: null,
    });
  });
});
