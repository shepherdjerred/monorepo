import { expect, test } from "vitest";
import { LoadingScreenDataSchema } from "@scout-for-lol/data";
import { clashPalette } from "@scout-for-lol/design-system/satori/clash-style";
import {
  getLoadingScreenCanvasDimensions,
  loadingScreenToImage,
  loadingScreenToSvg,
} from "#src/html/loading-screen/index.tsx";

const currentDir = new URL(".", import.meta.url).pathname;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function clashLoadingScreen() {
  const raw: unknown = await Bun.file(
    `${currentDir}testdata/ranked-flex-5v5.json`,
  ).json();
  const ranked = LoadingScreenDataSchema.parse(raw);
  const participants = ranked.participants.map((participant, index) => ({
    ...participant,
    isTrackedPlayer: index === 0,
  }));
  return LoadingScreenDataSchema.parse({
    ...ranked,
    queueType: "clash",
    queueDisplayName: "Clash",
    participants,
    clashChrome: {
      themeLabel: "Freljord · Day 1",
      blueTeam: { name: "Wolves", abbreviation: "WLV" },
      redTeam: { name: "Foxes", abbreviation: "FOX" },
    },
  });
}

test("Clash uses a taller dedicated canvas", async () => {
  const data = await clashLoadingScreen();
  expect(getLoadingScreenCanvasDimensions(data)).toEqual({
    width: 1600,
    height: 1490,
  });
});

test("Clash loading screen renders the gold canvas, not ranked chrome", async () => {
  const data = await clashLoadingScreen();
  const svg = await loadingScreenToSvg(data);
  expect(svg.startsWith("<svg ")).toBe(true);
  expect(svg).toContain('width="1600" height="1490"');
  expect(svg).toContain(clashPalette.frame);
  expect(svg).toContain(clashPalette.canvas);
  expect(svg).toContain('opacity="0.16"');
  expect(svg).toContain("data:image/png;base64,");
  expect(svg).not.toContain("ranked flex");

  const png = await loadingScreenToImage(data);
  expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect(view.getUint32(16)).toBe(1600);
  expect(view.getUint32(20)).toBe(1490);
  await Bun.write(new URL("__snapshots__/clash-5v5.png", import.meta.url), png);
  await Bun.write(new URL("__snapshots__/clash-5v5.svg", import.meta.url), svg);
}, 30_000);
