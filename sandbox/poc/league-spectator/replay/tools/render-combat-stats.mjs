import { resolve } from "node:path";
import { Resvg } from "../../../packages/report/node_modules/@resvg/resvg-js/index.js";
import { inspectionPanelSvg } from "../latest-inspection.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: render-combat-stats.mjs <cache>");
const cache = resolve(arg),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = await Bun.file(
    `${cache}/research/combat-stats-comparison.json`,
  ).arrayBuffer(),
  proof = JSON.parse(new TextDecoder().decode(raw)),
  catalog = await Bun.file(`${cache}/public/latest-items/package.json`).json(),
  images = new Map(),
  inputs = {};
for (const id of proof.observedItemIds) {
  const a = catalog.items[id],
    path = `${cache}/public/latest-items/${a.icon}`,
    png = await Bun.file(path).arrayBuffer();
  if (sha(png) !== a.iconSha256) throw Error("Stat panel icon changed");
  inputs[path] = sha(png);
  images.set(
    a.iconSha256,
    `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
  );
}
const rows = [];
let y = 178;
for (let i = 0; i < proof.cases.length; i += 2) {
  rows.push(y);
  y +=
    Math.max(...proof.cases.slice(i, i + 2).map((c) => c.drawing.height)) + 86;
}
const height = y + 150,
  parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${height}"><rect width="1600" height="${height}" fill="#09131d"/><g font-family="Arial" fill="#e4edf4">`,
    '<text x="55" y="64" font-size="35" font-weight="bold">Champion stats at the selected replay time</text>',
    '<text x="55" y="106" font-size="20" fill="#9cb1c4">Recorded inputs + original native stat projections · actual selected-unit panel drawing commands</text>',
    '<text x="55" y="140" font-size="18" fill="#9cb1c4">Sampled initial state, changing defenses and spellcaster stats · installed item icons</text>',
  ];
for (const [i, c] of proof.cases.entries()) {
  const x = 55 + (i % 2) * 770,
    top = rows[Math.floor(i / 2)];
  parts.push(
    `<text x="${x}" y="${top}" font-size="23" fill="#59d9b3">${c.label}</text><g transform="translate(${x},${top + 20})">${inspectionPanelSvg(c.drawing, images)}</g>`,
  );
}
parts.push(
  `<text x="55" y="${y + 22}" font-size="21">${(proof.counts.scalarChecks + proof.counts.probeScalarChecks).toLocaleString()} native scalar comparisons · ${proof.counts.reverseSeekChecks.toLocaleString()} reverse-seek checks · 24 recovered stats</text>`,
  `<text x="55" y="${y + 63}" font-size="18" fill="#9cb1c4">The panel shows eight primary stats. Sixteen additional native scalar values are available in the selected-unit details.</text>`,
  `<text x="55" y="${y + 100}" font-size="18" fill="#9cb1c4">Offscreen component render. Attack speed, XP progression, browser appearance and League A/V parity remain unverified.</text></g></svg>`,
);
const svg = parts.join(""),
  png = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
  })
    .render()
    .asPng(),
  out = `${cache}/public/evidence/latest-combat-stats`;
await Bun.write(`${out}.svg`, svg);
await Bun.write(`${out}.png`, png);
await Bun.write(
  `${out}.json`,
  JSON.stringify(
    {
      schema: 1,
      comparisonSha256: sha(raw),
      rendererSha256: sha(await Bun.file(import.meta.path).arrayBuffer()),
      inputs,
      imageSha256: sha(png),
      svgSha256: sha(svg),
      counts: proof.counts,
      scope: {
        ...proof.scope,
        offscreenPanelRender: true,
        actualBrowserCapture: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    image: `${out}.png`,
    imageSha256: sha(png),
    width: 1600,
    height,
  }),
);
