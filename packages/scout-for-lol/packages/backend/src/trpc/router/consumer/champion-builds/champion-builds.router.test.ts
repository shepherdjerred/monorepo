import { describe, expect, test } from "vitest";
import { createChampionPageTestEnv } from "#src/testing/consumer-champion-test-env.ts";
import { expectOneLakeSlot } from "#src/testing/consumer-profile-feature-test.ts";
import {
  AHRI,
  JINX,
  RIVER,
  TIDAL,
  VIEWER_ALT,
  VIEWER_MAIN,
  VIEWER_OTHER_GUILD,
  lobby,
  mid,
} from "#src/testing/consumer-champion-group.ts";

const {
  guildId,
  otherGuildId,
  profileFeature,
  trpc,
  caller,
  seedGroup,
  writeLobbies,
} = await createChampionPageTestEnv("trpc-consumer-champion-builds");

/** The viewer is in both servers, so their account on the second one counts. */
function enableBothServers() {
  profileFeature.enable(guildId, otherGuildId);
  trpc.setMembership([
    { guildId, asAdmin: false },
    { guildId: otherGuildId, asAdmin: false },
  ]);
}

const DORANS_RING = 1056;
const SORCERERS_SHOES = 3020;
const MALIGNANCE = 3118;
const SHADOWFLAME = 4645;
const RABADONS = 3089;
const LICH_BANE = 3100;
const LUDENS = 6655;
const VOID_STAFF = 3135;
const ELECTROCUTE = 8112;
const CONQUEROR = 8010;

/** Starters and boots come first, as they do in a game; they are not core. */
function build(items: number[], keystone: number) {
  return { purchases: [DORANS_RING, SORCERERS_SHOES, ...items], keystone };
}

const MALIGNANCE_BUILD = [MALIGNANCE, SHADOWFLAME, RABADONS];
const LICH_BANE_BUILD = [LICH_BANE, SHADOWFLAME, RABADONS];
const VIEWER_BUILD = [MALIGNANCE, LUDENS, VOID_STAFF];

function ahriGame(options: {
  n: number;
  who: Parameters<typeof mid>[0];
  win: boolean;
  items: number[];
  keystone: number;
  timeline?: "none";
}) {
  return lobby({
    n: options.n,
    hoursAgo: options.n,
    winner: options.win ? 100 : 200,
    ...(options.timeline === undefined ? {} : { timeline: options.timeline }),
    seats: [
      {
        ...mid(options.who, 100, AHRI, 5000),
        build: build(options.items, options.keystone),
      },
    ],
  });
}

/**
 * Ahri in mid, newest first. The viewer: 1h (main, win), 2h (alt, loss), 3h
 * (the account on the second server, win), all the viewer's build. Tidal: 4h,
 * 5h, 6h (win, win, loss) Malignance first, 7h with no timeline, 12h on top.
 * River: 8h Malignance first, 9h and 10h Lich Bane first, 11h with only two
 * finished items. 13h is River's Jinx, which no Ahri page counts.
 */
function groupBuildGames() {
  return [
    ahriGame({
      n: 1,
      who: VIEWER_MAIN,
      win: true,
      items: VIEWER_BUILD,
      keystone: ELECTROCUTE,
    }),
    ahriGame({
      n: 2,
      who: VIEWER_ALT,
      win: false,
      items: VIEWER_BUILD,
      keystone: ELECTROCUTE,
    }),
    ahriGame({
      n: 3,
      who: VIEWER_OTHER_GUILD,
      win: true,
      items: VIEWER_BUILD,
      keystone: CONQUEROR,
    }),
    ahriGame({
      n: 4,
      who: TIDAL,
      win: true,
      items: MALIGNANCE_BUILD,
      keystone: ELECTROCUTE,
    }),
    ahriGame({
      n: 5,
      who: TIDAL,
      win: true,
      items: MALIGNANCE_BUILD,
      keystone: ELECTROCUTE,
    }),
    ahriGame({
      n: 6,
      who: TIDAL,
      win: false,
      items: MALIGNANCE_BUILD,
      keystone: ELECTROCUTE,
    }),
    ahriGame({
      n: 7,
      who: TIDAL,
      win: true,
      items: MALIGNANCE_BUILD,
      keystone: ELECTROCUTE,
      timeline: "none",
    }),
    ahriGame({
      n: 8,
      who: RIVER,
      win: true,
      items: MALIGNANCE_BUILD,
      keystone: ELECTROCUTE,
    }),
    ahriGame({
      n: 9,
      who: RIVER,
      win: true,
      items: LICH_BANE_BUILD,
      keystone: ELECTROCUTE,
    }),
    ahriGame({
      n: 10,
      who: RIVER,
      win: false,
      items: LICH_BANE_BUILD,
      keystone: CONQUEROR,
    }),
    ahriGame({
      n: 11,
      who: RIVER,
      win: true,
      items: [MALIGNANCE, SHADOWFLAME],
      keystone: CONQUEROR,
    }),
    lobby({
      n: 12,
      hoursAgo: 12,
      winner: 100,
      seats: [
        {
          who: TIDAL,
          team: 100,
          position: "TOP",
          champion: AHRI,
          gold15: 5000,
          build: build(MALIGNANCE_BUILD, ELECTROCUTE),
        },
      ],
    }),
    lobby({
      n: 13,
      hoursAgo: 13,
      winner: 100,
      seats: [
        {
          who: RIVER,
          team: 100,
          position: "BOTTOM",
          champion: JINX,
          gold15: 5000,
          build: build([3031, 3094, 3036], 8008),
        },
      ],
    }),
  ];
}

describe("consumerChampion.builds", () => {
  test("tallies what the friends and the viewer build, with games and wins", async () => {
    enableBothServers();
    await seedGroup();
    await writeLobbies(groupBuildGames());

    const result = await caller().consumerChampion.builds({
      championId: AHRI.id,
      lane: "middle",
    });

    expect(result.champion).toEqual({ championId: AHRI.id, name: "Ahri" });
    expect(result.lane).toBe("middle");
    expect(result.friends).toEqual({
      games: 8,
      coreBuild: {
        // Tidal's three and River's one of 8h; 7h has no timeline, 11h two items.
        games: 6,
        options: [
          { value: MALIGNANCE_BUILD, games: 4, wins: 3 },
          { value: LICH_BANE_BUILD, games: 2, wins: 1 },
        ],
      },
      keystone: {
        games: 8,
        options: [
          { value: ELECTROCUTE, games: 6, wins: 5 },
          { value: CONQUEROR, games: 2, wins: 1 },
        ],
      },
    });
    // The viewer's three accounts, on two servers, are one person.
    expect(result.you).toEqual({
      games: 3,
      coreBuild: {
        games: 3,
        options: [{ value: VIEWER_BUILD, games: 3, wins: 2 }],
      },
      keystone: {
        games: 3,
        options: [
          { value: ELECTROCUTE, games: 2, wins: 1 },
          { value: CONQUEROR, games: 1, wins: 1 },
        ],
      },
    });
    // River opens with Lich Bane in two of three; Tidal opens as the group does.
    expect(result.differing).toEqual([
      {
        playerId: expect.any(Number),
        alias: "RiverQuartz",
        itemId: LICH_BANE,
        games: 2,
        wins: 1,
        ofGames: 3,
      },
    ]);
  });

  test("reads every lane unless one is asked for, and the servers asked for", async () => {
    enableBothServers();
    await seedGroup();
    await writeLobbies(groupBuildGames());

    const anyLane = await caller().consumerChampion.builds({
      championId: AHRI.id,
    });
    expect(anyLane.lane).toBeNull();
    // Tidal's top game joins the middle games.
    expect(anyLane.friends.games).toBe(9);
    expect(anyLane.friends.coreBuild.options[0]).toEqual({
      value: MALIGNANCE_BUILD,
      games: 5,
      wins: 4,
    });
    const scoped = await caller().consumerChampion.builds({
      championId: AHRI.id,
      lane: "middle",
      guildIds: [guildId],
    });
    // The account on the other server is outside the one server asked for.
    expect(scoped.you?.games).toBe(2);
  });

  test("is stable between requests and counts a game once", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeLobbies(groupBuildGames());
    const first = await caller().consumerChampion.builds({
      championId: AHRI.id,
    });
    expect(
      await caller().consumerChampion.builds({ championId: AHRI.id }),
    ).toEqual(first);
    expect(first.friends.games).toBe(9);
  });

  test("a champion nobody played has empty slots and no viewer setup", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeLobbies(groupBuildGames());
    const empty = { games: 0, options: [] };
    await expect(
      caller().consumerChampion.builds({ championId: 134 }),
    ).resolves.toMatchObject({
      friends: { games: 0, coreBuild: empty, keystone: empty },
      you: null,
      differing: [],
    });
    await expect(
      caller().consumerChampion.builds({
        championId: AHRI.id,
        lane: "support",
      }),
    ).resolves.toMatchObject({ friends: { games: 0 }, you: null });
  });

  test("a game without a timeline still counts toward the keystone", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeLobbies([
      ahriGame({
        n: 1,
        who: TIDAL,
        win: true,
        items: MALIGNANCE_BUILD,
        keystone: ELECTROCUTE,
        timeline: "none",
      }),
    ]);
    const { friends } = await caller().consumerChampion.builds({
      championId: AHRI.id,
    });
    expect(friends.games).toBe(1);
    expect(friends.coreBuild).toEqual({ games: 0, options: [] });
    expect(friends.keystone.options).toEqual([
      { value: ELECTROCUTE, games: 1, wins: 1 },
    ]);
  });

  test("takes exactly one lake slot", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeLobbies(groupBuildGames());
    await expectOneLakeSlot(() =>
      caller().consumerChampion.builds({ championId: AHRI.id }),
    );
  });
});
