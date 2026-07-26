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

test("banner — 3-player squad with public champion name", async () => {
  const match = rankedFixture({
    queueType: "solo",
    trackedCount: 3,
    outcome: "Victory",
  });
  const hero = match.players[1];
  if (hero === undefined) {
    throw new Error("Missing expected banner hero fixture");
  }
  hero.champion.championName = "MonkeyKing";
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

test("banner — 6-player squad", async () => {
  const match = rankedFixture({
    queueType: "flex",
    trackedCount: 6,
    outcome: "Victory",
  });
  const svg = await matchToSvg(match, { designOverride: "banner" });
  const png = await svgToPng(svg);
  await writeOutputs("banner_squad_6", svg, png);
  expect(hashSvg(svg)).toMatchSnapshot();
});

test("banner — 10-player squad", async () => {
  const match = rankedFixture({
    queueType: "flex",
    trackedCount: 10,
    outcome: "Victory",
  });
  const svg = await matchToSvg(match, { designOverride: "banner" });
  const png = await svgToPng(svg);
  await writeOutputs("banner_squad_10", svg, png);
  expect(hashSvg(svg)).toMatchSnapshot();
});

test("banner — 11-player squad spans three groups", async () => {
  // Cross-guild duplicate configs track the same puuid more than once, so
  // match.players can exceed the ten distinct participants in a real game.
  // splitSquad(11) yields three groups ([4, 4, 3] — see squad-layout.test.ts),
  // which pushes this banner past the two-column layout it was originally
  // sized for. Reuse the first tracked player as an eleventh entry to
  // reproduce that without a fixture rewrite.
  const match = rankedFixture({
    queueType: "flex",
    trackedCount: 10,
    outcome: "Victory",
  });
  const extraPlayer = match.players[0];
  if (extraPlayer === undefined) {
    throw new Error("Missing expected banner hero fixture");
  }
  const elevenPlayerMatch = {
    ...match,
    players: [...match.players, extraPlayer],
  };
  const svg = await matchToSvg(elevenPlayerMatch, {
    designOverride: "banner",
  });
  const png = await svgToPng(svg);
  await writeOutputs("banner_squad_11", svg, png);
  expect(hashSvg(svg)).toMatchSnapshot();
});
