import { strict as assert } from "node:assert";
import {
  classicMatchToImage,
  classicMatchToSvg,
  loadingScreenToImage,
  loadingScreenToSvg,
} from "#src/index.ts";
import {
  classicLoadingScreenFixture,
  classicMatchFixture,
} from "#src/testing/classic-fixtures.ts";

const outputDirectory =
  Bun.env["SCOUT_CLASSIC_VISUAL_OUTPUT_DIRECTORY"] ??
  `${import.meta.dir}/../artifacts/classic`;

async function writeVisual(
  name: string,
  svg: string,
  png: Uint8Array,
): Promise<void> {
  assert.match(svg, /^<svg /);
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  await Promise.all([
    Bun.write(`${outputDirectory}/${name}.svg`, svg),
    Bun.write(`${outputDirectory}/${name}.png`, png),
  ]);
}

const fullPrematch = classicLoadingScreenFixture();
const partialPrematch = classicLoadingScreenFixture(3, 2);
const postmatch = classicMatchFixture();
const partialPostmatch = classicMatchFixture(3, 2, "Surrender", {
  heroGameName:
    "A Classic Summoner Name Long Enough To Require Safe Truncation",
});

const fullSvg = await loadingScreenToSvg(fullPrematch);
const fullSvgRepeat = await loadingScreenToSvg(fullPrematch);
assert.equal(
  fullSvg,
  fullSvgRepeat,
  "Classic prematch SVG must be deterministic",
);
assert.match(fullSvg, /width="1920" height="1280"/);

const postSvg = await classicMatchToSvg(postmatch);
const postSvgRepeat = await classicMatchToSvg(postmatch);
assert.equal(
  postSvg,
  postSvgRepeat,
  "Classic postmatch SVG must be deterministic",
);
assert.match(postSvg, /width="1920" height="1200"/);

const partialPostSvg = await classicMatchToSvg(partialPostmatch);
assert.match(partialPostSvg, /width="1920" height="860"/);

const outcomeSvgs = await Promise.all(
  (["Victory", "Defeat", "Surrender"] as const).map((outcome) =>
    classicMatchToSvg(classicMatchFixture(5, 5, outcome)),
  ),
);
assert.equal(
  new Set(outcomeSvgs).size,
  3,
  "Victory, Defeat, and Surrender must produce distinct reports",
);

await Promise.all([
  writeVisual(
    "prematch-full-5v5",
    fullSvg,
    await loadingScreenToImage(fullPrematch),
  ),
  writeVisual(
    "prematch-partial-3v2",
    await loadingScreenToSvg(partialPrematch),
    await loadingScreenToImage(partialPrematch),
  ),
  writeVisual(
    "postmatch-full-5v5",
    postSvg,
    await classicMatchToImage(postmatch),
  ),
  writeVisual(
    "postmatch-partial-3v2",
    partialPostSvg,
    await classicMatchToImage(partialPostmatch),
  ),
]);

console.log(`Classic visual verification wrote ${outputDirectory}`);
