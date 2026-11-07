// Render the viewer's plate drawing commands without browser automation.
import { resolve } from "node:path";
import { Resvg } from "../../../packages/report/node_modules/@resvg/resvg-js/index.js";
import { championPlateSvg } from "../latest-overhead.mjs";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: render-latest-health.mjs <cache>");
const cache = resolve(cacheArg),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  path = `${cache}/research/latest-health-comparison.json`,
  raw = new Uint8Array(await Bun.file(path).arrayBuffer()),
  proof = JSON.parse(new TextDecoder().decode(raw)),
  parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1200"><rect width="1800" height="1200" fill="#09131d"/><g font-family="Arial" fill="#e4edf4">`,
    `<text x="60" y="65" font-size="36" font-weight="bold">Latest-build health now drives champion overhead bars</text>`,
    `<text x="60" y="105" font-size="20" fill="#9cb1c4">Actual recorded values · all ten champions · absolute-time sampling · same drawing commands as the viewer</text>`,
  ];
for (const [col, time] of [0, 60, 105].entries()) {
  const x = 60 + col * 580;
  parts.push(
    `<text x="${x}" y="160" font-size="24" fill="#59d9b3">Replay time ${time}s</text>`,
  );
  const cases = proof.cases.filter((c) => c.time === time && !c.transition);
  for (const [index, c] of cases.entries()) {
    const y = 174 + index * 75;
    parts.push(
      `<g transform="translate(${x},${y})">${championPlateSvg(c.drawing)}</g>`,
    );
    parts.push(
      `<text x="${x + 270}" y="${y + 45}" font-size="17" fill="#9cb1c4">${c.state.dead ? "Dead · overhead hidden" : `${c.state.currentHealth.toFixed(1)} / ${c.state.maxHealth.toFixed(1)} HP`}</text>`,
    );
  }
}
parts.push(
  `<text x="60" y="975" font-size="23" font-weight="bold">Death / respawn: overhead visibility follows recorded lifecycle</text>`,
);
for (const [i, c] of proof.cases.filter((c) => c.transition).entries()) {
  const x = 60 + i * 580,
    y = 990;
  parts.push(
    `<g transform="translate(${x},${y})">${championPlateSvg(c.drawing)}</g>`,
  );
  parts.push(
    `<text x="${x + 270}" y="${y + 45}" font-size="17" fill="#9cb1c4">${c.time.toFixed(2)}s · ${c.state.dead ? "hidden" : "visible"}</text>`,
  );
}
parts.push(
  `<text x="60" y="1110" font-size="19">${proof.counts.healthUpdates.toLocaleString()} health updates · ${proof.counts.packetChecks} native/WASM packets · ${proof.counts.reverseSeekChecks} reverse-seek checks · 8 deaths and 8 respawns</text>`,
);
parts.push(
  `<text x="60" y="1145" font-size="17" fill="#9cb1c4">Styling/font/segmentation are approximate. Champion names are used; player names, level, resources and shields remain unresolved.</text>`,
);
parts.push(
  `<text x="60" y="1178" font-size="17" fill="#9cb1c4">Offscreen UI evidence only. Actual browser scene submission and matching League A/V comparison remain unverified.</text></g></svg>`,
);
const svg = parts.join(""),
  png = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
  })
    .render()
    .asPng(),
  output = `${cache}/public/evidence/latest-health`;
await Bun.write(`${output}.svg`, svg);
await Bun.write(`${output}.png`, png);
await Bun.write(
  `${output}.json`,
  JSON.stringify(
    {
      schema: 1,
      comparisonSha256: sha(raw),
      rendererSha256: sha(await Bun.file(import.meta.path).arrayBuffer()),
      svgSha256: sha(svg),
      imageSha256: sha(png),
      counts: proof.counts,
      scope: proof.scope,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ image: `${output}.png`, imageSha256: sha(png) }));
