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

test("square — solo victory with commentary", async () => {
  const match = rankedFixture({
    queueType: "solo",
    trackedCount: 1,
    outcome: "Victory",
    commentary: "Warwick ate the deaths so the carries could feast.",
  });
  const svg = await matchToSvg(match, { designOverride: "square" });
  const png = await svgToPng(svg);
  await writeOutputs("square_solo_victory_commentary", svg, png);
  expect(hashSvg(svg)).toMatchSnapshot();
});

test("square — solo defeat without commentary", async () => {
  const match = rankedFixture({
    queueType: "flex",
    trackedCount: 1,
    outcome: "Defeat",
  });
  const svg = await matchToSvg(match, { designOverride: "square" });
  const png = await svgToPng(svg);
  await writeOutputs("square_solo_defeat_no_commentary", svg, png);
  expect(hashSvg(svg)).toMatchSnapshot();
});

test("square — 5-player squad with commentary", async () => {
  const match = rankedFixture({
    queueType: "solo",
    trackedCount: 5,
    outcome: "Victory",
    commentary: "Warwick ate the deaths so the carries could feast.",
  });
  const svg = await matchToSvg(match, { designOverride: "square" });
  const png = await svgToPng(svg);
  await writeOutputs("square_squad_5_commentary", svg, png);
  expect(hashSvg(svg)).toMatchSnapshot();
});

test("square — 3-player squad", async () => {
  const match = rankedFixture({
    queueType: "solo",
    trackedCount: 3,
    outcome: "Victory",
  });
  const svg = await matchToSvg(match, { designOverride: "square" });
  const png = await svgToPng(svg);
  await writeOutputs("square_squad_3", svg, png);
  expect(hashSvg(svg)).toMatchSnapshot();
});
