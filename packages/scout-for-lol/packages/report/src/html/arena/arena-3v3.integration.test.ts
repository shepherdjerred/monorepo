import { expect, test } from "bun:test";
import { ArenaMatchSchema } from "@scout-for-lol/data";
import { arenaMatchToImage, arenaMatchToSvg } from "#src/html/arena/index.tsx";

const currentDir = new URL(".", import.meta.url).pathname;

test("Arena report renders a tracked 3-player team", async () => {
  const raw = await Bun.file(`${currentDir}testdata/3v3.json`).json();
  const match = ArenaMatchSchema.parse(raw);

  expect(match.teams).toHaveLength(6);
  expect(match.teams[0]?.players).toHaveLength(3);
  expect(match.players[0]?.teammates).toHaveLength(2);

  const svg = await arenaMatchToSvg(match);
  expect(svg.slice(0, 4)).toBe("<svg");

  const png = await arenaMatchToImage(match);
  expect(png.byteLength).toBeGreaterThan(1000);
});
