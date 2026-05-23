import { expect, test } from "bun:test";
import {
  ArenaMatchSchema,
  type ArenaChampion,
  type ArenaMatch,
} from "@scout-for-lol/data";
import { getCachedArenaAugmentById } from "@scout-for-lol/data/data-dragon/arena-augments.ts";
import { arenaMatchToImage, arenaMatchToSvg } from "#src/html/arena/index.tsx";
import { getDamageSharePercent } from "#src/html/arena/player-column.tsx";

const currentDir = new URL(".", import.meta.url).pathname;
const sixAugmentFillerIds = [1, 2, 3, 4, 5, 6];

test("Arena report renders a tracked 3-player team", async () => {
  const raw = await Bun.file(`${currentDir}testdata/3v3.json`).json();
  const match = ArenaMatchSchema.parse(raw);

  expect(match.teams).toHaveLength(6);
  expect(match.teams[0]?.players).toHaveLength(3);
  expect(match.players[0]?.teammates).toHaveLength(2);
  for (const team of match.teams) {
    for (const player of team.players) {
      expect(player.augments.every((augment) => augment.type === "full")).toBe(
        true,
      );
    }
  }

  const svg = await arenaMatchToSvg(match);
  expect(svg.slice(0, 4)).toBe("<svg");

  const firstTeam = match.teams[0];
  if (firstTeam === undefined) {
    throw new Error("Expected at least one Arena team");
  }
  const totalDamage = firstTeam.players.reduce(
    (sum, player) => sum + player.damage,
    0,
  );
  expect(
    firstTeam.players.map((player) =>
      getDamageSharePercent(player.damage, totalDamage),
    ),
  ).toEqual([31, 33, 36]);

  const png = await arenaMatchToImage(match);
  expect(png.byteLength).toBeGreaterThan(1000);
});

test("Arena report renders six real augment rows", async () => {
  const raw = await Bun.file(`${currentDir}testdata/3v3.json`).json();
  const match = withSixRealAugments(ArenaMatchSchema.parse(raw));

  for (const team of match.teams) {
    for (const player of team.players) {
      expect(player.augments).toHaveLength(6);
      expect(player.augments.every((augment) => augment.type === "full")).toBe(
        true,
      );
    }
  }

  const png = await arenaMatchToImage(match);
  expect(png.byteLength).toBeGreaterThan(1000);
});

function withSixRealAugments(match: ArenaMatch): ArenaMatch {
  return ArenaMatchSchema.parse({
    ...match,
    players: match.players.map((player) => ({
      ...player,
      champion: fillChampionAugments(player.champion),
      teammates: player.teammates.map((teammate) =>
        fillChampionAugments(teammate),
      ),
    })),
    teams: match.teams.map((team) => ({
      ...team,
      players: team.players.map((player) => fillChampionAugments(player)),
    })),
  });
}

function fillChampionAugments(champion: ArenaChampion): ArenaChampion {
  const augments = [...champion.augments];
  let index = 0;
  while (augments.length < 6) {
    const id = sixAugmentFillerIds[index % sixAugmentFillerIds.length];
    if (id === undefined) {
      throw new Error("Expected at least one six-augment filler id");
    }
    const augment = getCachedArenaAugmentById(id);
    if (augment === undefined) {
      throw new Error(`Expected cached Arena augment ${id.toString()}`);
    }
    augments.push(augment);
    index += 1;
  }
  return { ...champion, augments };
}
