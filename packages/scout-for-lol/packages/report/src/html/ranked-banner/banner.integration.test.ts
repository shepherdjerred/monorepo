import { test, expect } from "bun:test";
import { matchToSvg, svgToPng } from "#src/html/index.tsx";
import { rankedFixture } from "#src/html/shared/test-fixtures.ts";

function hashSvg(svg: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(svg);
  return hasher.digest("hex");
}

async function writeOutputs(name: string, svg: string, png: Uint8Array) {
  await Bun.write(new URL(`__snapshots__/${name}.svg`, import.meta.url), svg);
  await Bun.write(new URL(`__snapshots__/${name}.png`, import.meta.url), png);
}

test("banner — solo victory", async () => {
  const match = rankedFixture({
    queueType: "solo",
    trackedCount: 1,
    outcome: "Victory",
  });
  const svg = await matchToSvg(match, { designOverride: "banner" });
  const png = await svgToPng(svg);
  await writeOutputs("banner_solo_victory", svg, png);
  expect(hashSvg(svg)).toMatchSnapshot();
});

test("banner — solo defeat (ranked flex)", async () => {
  const match = rankedFixture({
    queueType: "flex",
    trackedCount: 1,
    outcome: "Defeat",
  });
  const svg = await matchToSvg(match, { designOverride: "banner" });
  const png = await svgToPng(svg);
  await writeOutputs("banner_solo_defeat_flex", svg, png);
  expect(hashSvg(svg)).toMatchSnapshot();
});

test("banner — 3-player squad", async () => {
  const match = rankedFixture({
    queueType: "solo",
    trackedCount: 3,
    outcome: "Victory",
  });
  const svg = await matchToSvg(match, { designOverride: "banner" });
  const png = await svgToPng(svg);
  await writeOutputs("banner_squad_3", svg, png);
  expect(hashSvg(svg)).toMatchSnapshot();
});

test("banner — 5-player squad", async () => {
  const match = rankedFixture({
    queueType: "solo",
    trackedCount: 5,
    outcome: "Victory",
  });
  const svg = await matchToSvg(match, { designOverride: "banner" });
  const png = await svgToPng(svg);
  await writeOutputs("banner_squad_5", svg, png);
  expect(hashSvg(svg)).toMatchSnapshot();
});
