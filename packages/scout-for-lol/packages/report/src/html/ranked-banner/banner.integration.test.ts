import { test, expect, setDefaultTimeout } from "bun:test";
import { matchToSvg, svgToPng } from "#src/html/index.tsx";
import { rankedFixture } from "#src/html/shared/test-fixtures.ts";

// Each banner render is a full 4760x1500 satori pass and can exceed Bun's 5s
// default per-test timeout on a cold CI engine, so give it headroom — the
// render succeeds, it just needs more than 5s when caches are cold. Without
// this, a timed-out test also drifts Bun's snapshot counter, comparing each
// render against the next test's committed hash.
setDefaultTimeout(30_000);

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
