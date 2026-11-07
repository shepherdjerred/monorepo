import { resolve } from "node:path";
import { Resvg } from "../../../packages/report/node_modules/@resvg/resvg-js/index.js";
import { inspectionPanelSvg } from "../latest-inspection.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: render-experience.mjs <cache>");
const cache = resolve(arg),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = await Bun.file(
    `${cache}/research/experience-comparison.json`,
  ).arrayBuffer(),
  proof = JSON.parse(new TextDecoder().decode(raw)),
  first = proof.cases.find((c) => c.model.entityClass === "champion").model
    .entityId,
  cases = [
    proof.cases.find((c) => c.model.entityId === first && c.model.time === 0),
    proof.cases.find((c) => c.model.entityId === first && c.model.time === 105),
    ...[
      "Minion in combat",
      "Minion after death",
      "Tower",
      "Minion before spawn",
    ].map((label) => proof.cases.find((c) => c.label === label)),
  ],
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
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1500"><rect width="1600" height="1500" fill="#09131d"/><g font-family="Arial" fill="#e4edf4">',
    '<text x="55" y="64" font-size="35" font-weight="bold">Unit inspection and recorded experience</text>',
    '<text x="55" y="108" font-size="20" fill="#9cb1c4">Shared viewer panel drawing commands · sampled replay values · selection persists across seeking</text>',
  ];
for (const [i, c] of cases.entries()) {
  const x = 55 + (i % 2) * 770,
    y = [160, 690, 1035][Math.floor(i / 2)];
  parts.push(
    `<text x="${x}" y="${y}" font-size="23" fill="#59d9b3">${esc(c.label)}</text>`,
    `<g transform="translate(${x},${y + 20})">${inspectionPanelSvg(c.drawing)}</g>`,
  );
}
parts.push(
  `<text x="55" y="1370" font-size="21">${proof.counts.getterChecks.toLocaleString()} native XP getter matches · ${proof.counts.reverseSeekChecks.toLocaleString()} reverse-seek panel checks · 48 world selections</text>`,
  '<text x="55" y="1415" font-size="18" fill="#9cb1c4">Items, KDA, CS, combat stats and mode-specific XP progression remain unavailable. Panel styling is approximate.</text>',
  '<text x="55" y="1455" font-size="18" fill="#9cb1c4">Offscreen component render. Browser interaction and matching League presentation remain unverified.</text></g></svg>',
);
const svg = parts.join(""),
  png = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
  })
    .render()
    .asPng(),
  out = `${cache}/public/evidence/latest-experience`;
await Bun.write(`${out}.svg`, svg);
await Bun.write(`${out}.png`, png);
await Bun.write(
  `${out}.json`,
  JSON.stringify(
    {
      schema: 1,
      comparisonSha256: sha(raw),
      rendererSha256: sha(await Bun.file(import.meta.path).arrayBuffer()),
      imageSha256: sha(png),
      svgSha256: sha(svg),
      counts: proof.counts,
      scope: proof.scope,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ image: `${out}.png`, imageSha256: sha(png) }));
