import { expect, test } from "bun:test";
import satori from "satori";
import { LoadingScreenDataSchema } from "@scout-for-lol/data";
import { bunBeaufortFonts, bunSpiegelFonts } from "#src/assets/index.ts";
import { palette } from "#src/assets/colors.ts";
import { GameHeader } from "#src/html/loading-screen/game-header.tsx";

const currentDir = new URL(".", import.meta.url).pathname;

async function renderHeaderSvg(fileName: string): Promise<string> {
  const raw = await Bun.file(`${currentDir}testdata/${fileName}`).json();
  const data = LoadingScreenDataSchema.parse(raw);
  const fonts = [...(await bunBeaufortFonts()), ...(await bunSpiegelFonts())];

  return satori(<GameHeader data={data} />, {
    width: 1600,
    height: 180,
    fonts,
  });
}

test("GameHeader hides the ban row when no bans are present", async () => {
  const svg = await renderHeaderSvg("arena-3v3.json");

  expect(svg).not.toContain(palette.teams.blue);
  expect(svg).not.toContain(palette.teams.red);
  expect(svg).not.toContain(palette.grey[5]);
});

test("GameHeader keeps ban slots when any bans are present", async () => {
  const svg = await renderHeaderSvg("ranked-flex-5v5.json");

  expect(svg).toContain(palette.teams.blue);
  expect(svg).toContain(palette.teams.red);
});
