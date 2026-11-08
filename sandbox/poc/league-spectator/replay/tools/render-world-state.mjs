import { resolve } from "node:path";
import { Resvg } from "../../../packages/report/node_modules/@resvg/resvg-js/index.js";
import { championPlateSvg } from "../latest-overhead.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: render-world-state.mjs <cache>");
const cache = resolve(arg),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = await Bun.file(
    `${cache}/research/world-state-comparison.json`,
  ).arrayBuffer(),
  proof = JSON.parse(new TextDecoder().decode(raw)),
  esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c],
    ),
  parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1130"><rect width="1600" height="1130" fill="#09131d"/><g font-family="Arial" fill="#e4edf4">',
    '<text x="55" y="65" font-size="34" font-weight="bold">Minion and tower health follows recorded state</text>',
    '<text x="55" y="106" font-size="19" fill="#9cb1c4">Original class schemas and health getters · shared viewer drawing commands · overheads enlarged 4×</text>',
  ];
for (const [i, c] of proof.cases.entries()) {
  const x = 55 + (i % 2) * 755,
    y = 145 + Math.floor(i / 2) * 265,
    s = c.state,
    hp =
      s.currentHealth === null || s.maxHealth === null
        ? "HP not yet observed"
        : `${s.currentHealth.toFixed(2)} / ${s.maxHealth.toFixed(2)} HP`,
    visibility = !s.present
      ? "Not spawned — overhead hidden"
      : s.dead
        ? "Recorded death — overhead hidden"
        : !c.drawing.available
          ? "Waiting for recorded HP — overhead hidden"
          : "Overhead visible";
  parts.push(
    `<rect x="${x}" y="${y}" width="725" height="240" rx="12" fill="#112330" stroke="#29424f"/>`,
    `<text x="${x + 24}" y="${y + 36}" font-size="23" font-weight="bold">${esc(c.label)}</text>`,
    `<text x="${x + 24}" y="${y + 66}" font-size="17" fill="#9cb1c4">${esc(c.entity.asset)} · ${c.time.toFixed(3)}s · 0x${c.entity.entityId.toString(16)}</text>`,
    `<g transform="translate(${x + 24},${y + 95}) scale(2)">${championPlateSvg(c.drawing)}</g>`,
    `<text x="${x + 24}" y="${y + 179}" font-size="20">${esc(hp)}</text>`,
    `<text x="${x + 24}" y="${y + 213}" font-size="17" fill="#59d9b3">${esc(visibility)}</text>`,
  );
}
parts.push(
  `<text x="55" y="990" font-size="21">${proof.counts.minions} minions · ${proof.counts.towers} towers · ${proof.counts.updates} HP updates · ${proof.counts.reverseSeekChecks.toLocaleString()} reverse-seek state checks</text>`,
  '<text x="55" y="1034" font-size="17" fill="#9cb1c4">Minion allegiance remains unresolved (neutral palette). Geometry, placement and occlusion are preview conventions.</text>',
  '<text x="55" y="1073" font-size="17" fill="#9cb1c4">Offscreen component render. Browser scene acceptance and matching League A/V comparison remain unverified.</text></g></svg>',
);
const svg = parts.join(""),
  png = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
  })
    .render()
    .asPng(),
  out = `${cache}/public/evidence/latest-world-state`;
await Bun.write(`${out}.svg`, svg);
await Bun.write(`${out}.png`, png);
await Bun.write(
  `${out}.json`,
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
console.log(JSON.stringify({ image: `${out}.png`, imageSha256: sha(png) }));
