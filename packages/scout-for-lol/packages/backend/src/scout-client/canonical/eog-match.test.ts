import {
  EndOfGameMatchSchema,
  matchCoverageOf,
  matchDataSourceOf,
} from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";
import {
  LCU_BOT_UUID,
  translatePayloadIdentities,
} from "#src/scout-client/identity-alias.ts";
import {
  aliasedLcuBundle,
  lcuAliasesFor,
} from "#src/testing/report-lake/lcu-bundle-fixtures.ts";
import {
  classicEndOfGameBlock as classicBlock,
  classicGameflow as gameflowFor,
  classicMatchId,
  rawClassicEndOfGameBlock,
} from "#src/testing/scout-client/end-of-game-fixtures.ts";
import { convertLcuMatchBundle } from "./lcu-match.ts";
import { convertEndOfGameMatch } from "./eog-match.ts";

const matchId = await classicMatchId();

describe("convertEndOfGameMatch", () => {
  test("converts the Classic end-of-game block alone with every stated fact", async () => {
    const block = await classicBlock();
    const match = convertEndOfGameMatch({
      matchId,
      endOfGame: block,
      gameflow: gameflowFor(block),
    });

    expect(match).not.toBeNull();
    if (match === null) return;
    expect(EndOfGameMatchSchema.parse(match)).toEqual(match);
    expect(matchCoverageOf(match.metadata)).toBe("end_of_game");
    expect(matchDataSourceOf(match.metadata)).toBe("SCOUT_CLIENT");
    expect(match.info).toMatchObject({
      queueId: 4310,
      mapId: 453,
      platformId: "NA1",
      gameMode: "JADE",
      gameDuration: 1799,
      gameEndTimestamp: 1_792_385_795_384,
      gameStartTimestamp: 1_792_385_795_384 - 1_799_000,
      endOfGameResult: "GameComplete",
    });
    expect(match.info.participants).toHaveLength(10);
    expect(match.metadata.participants).toHaveLength(10);

    // The same game's history bundle states these, so they agree with it.
    const bundled = convertLcuMatchBundle(
      matchId,
      await aliasedLcuBundle("lcu-postgame-classic"),
    );
    if (bundled === null) throw new Error("The Classic bundle must convert");
    for (const participant of match.info.participants) {
      const twin = bundled.info.participants.find(
        (other) => other.puuid === participant.puuid,
      );
      if (twin === undefined) throw new Error("Both name the same players");
      expect(participant.participantId).toBeNull();
      expect(participant).toMatchObject({
        kills: twin.kills,
        deaths: twin.deaths,
        assists: twin.assists,
        goldEarned: twin.goldEarned,
        item0: twin.item0,
        item6: twin.item6,
        summoner1Id: twin.summoner1Id,
        perks: twin.perks,
        win: twin.win,
        teamPosition: twin.teamPosition,
        championId: twin.championId,
        visionScore: twin.visionScore,
      });
    }
    for (const team of match.info.teams) {
      const twin = bundled.info.teams.find(
        (other) => other.teamId === team.teamId,
      );
      expect(team.win).toBe(twin?.win);
      expect(team.objectives.champion.kills).toBe(
        twin?.objectives.champion.kills,
      );
      expect(team.objectives.tower.kills).toBe(twin?.objectives.tower.kills);
      expect(team.objectives.inhibitor.kills).toBe(
        twin?.objectives.inhibitor.kills,
      );
      expect(team.objectives.baron.kills).toBe(twin?.objectives.baron.kills);
      expect(team.objectives.dragon.kills).toBe(twin?.objectives.dragon.kills);
      // Flags and one-sided counts decide these firsts.
      expect(team.objectives.champion.first).toBe(
        twin?.objectives.champion.first,
      );
      expect(team.objectives.tower.first).toBe(twin?.objectives.tower.first);
      expect(team.objectives.baron.first).toBe(twin?.objectives.baron.first);
      expect(team.objectives.inhibitor.first).toBe(
        twin?.objectives.inhibitor.first,
      );
    }
  });

  test("states every unknown as null, never zero", async () => {
    const block = await classicBlock();
    const match = convertEndOfGameMatch({
      matchId,
      endOfGame: block,
      gameflow: gameflowFor(block),
    });
    if (match === null) throw new Error("The Classic block must convert");

    expect(match.info.gameCreation).toBeNull();
    expect(match.info.gameVersion).toBeNull();
    expect(
      match.info.participants.every(
        (participant) => participant.participantId === null,
      ),
    ).toBe(true);
    for (const team of match.info.teams) {
      // Gameflow states no bans, and an empty list cannot tell "none".
      expect(team.bans).toBeNull();
      expect(team.feats).toBeNull();
      expect(team.objectives.riftHerald).toEqual({ first: null, kills: null });
      expect(team.objectives.horde).toEqual({ first: null, kills: null });
      expect(team.objectives.atakhan).toEqual({ first: null, kills: null });
      // Both sides took dragons, so no stated fact says who took the first.
      expect(team.objectives.dragon.first).toBeNull();
    }
  });

  test("keeps bans gameflow states", async () => {
    const block = await classicBlock();
    const match = convertEndOfGameMatch({
      matchId,
      endOfGame: block,
      gameflow: gameflowFor(block, {
        bannedChampions: [
          { championId: 1, teamId: 100, pickTurn: 1 },
          { championId: 2, teamId: 200, pickTurn: 2 },
        ],
      }),
    });

    expect(match?.info.teams.map((team) => [team.teamId, team.bans])).toEqual(
      expect.arrayContaining([
        [100, [{ championId: 1, pickTurn: 1 }]],
        [200, [{ championId: 2, pickTurn: 2 }]],
      ]),
    );
  });

  test("records bots and unaliased players without inventing an identity", async () => {
    const block = await rawClassicEndOfGameBlock();
    const [first, second] = block.teams;
    const bot = second?.players[0];
    if (first === undefined || bot === undefined)
      throw new Error("The fixture has two teams");
    bot.puuid = LCU_BOT_UUID;
    bot.botPlayer = true;
    // Alias everyone on the first team only; the rest stay League-client UUIDs.
    const aliases = lcuAliasesFor({ teams: [first] });
    const match = convertEndOfGameMatch({
      matchId,
      endOfGame: translatePayloadIdentities(block, aliases),
      gameflow: gameflowFor(block),
    });

    expect(match).not.toBeNull();
    const kinds = match?.info.participants.map(
      (participant) => participant.participantKind,
    );
    expect(kinds?.filter((kind) => kind === "bot")).toHaveLength(1);
    expect(kinds?.filter((kind) => kind === "unresolved")).toHaveLength(4);
    expect(match?.metadata.participants).toHaveLength(5);
  });

  test.each([
    ["another game's gameflow", { gameId: 99 }],
    [
      "another queue's gameflow",
      {
        queue: {
          id: 420,
          type: "RANKED_SOLO_5x5",
          gameMode: "CLASSIC",
          mapId: 11,
        },
      },
    ],
  ])("refuses %s", async (_name, gameData) => {
    const block = await classicBlock();
    expect(
      convertEndOfGameMatch({
        matchId,
        endOfGame: block,
        gameflow: gameflowFor(block, gameData),
      }),
    ).toBeNull();
  });

  test.each(["turretsLost", "kills", "WIN"])(
    "refuses a block missing the stated %s it derives from",
    async (stat) => {
      const block = await classicBlock();
      const player = block.teams[0]?.players[0];
      if (player === undefined) throw new Error("The fixture has players");
      Reflect.deleteProperty(player.stats, stat);
      expect(
        convertEndOfGameMatch({
          matchId,
          endOfGame: block,
          gameflow: gameflowFor(block),
        }),
      ).toBeNull();
    },
  );

  test("refuses a player whose win contradicts its team", async () => {
    const block = await classicBlock();
    const player = block.teams[0]?.players[0];
    if (player === undefined) throw new Error("The fixture has players");
    player.stats["WIN"] = player.stats["WIN"] === 1 ? 0 : 1;
    player.stats["win"] = player.stats["WIN"];
    expect(
      convertEndOfGameMatch({
        matchId,
        endOfGame: block,
        gameflow: gameflowFor(block),
      }),
    ).toBeNull();
  });
});
