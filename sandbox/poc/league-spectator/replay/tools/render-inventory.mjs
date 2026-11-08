import { resolve } from "node:path";
import { Resvg } from "../../../packages/report/node_modules/@resvg/resvg-js/index.js";
import { inspectionPanelSvg } from "../latest-inspection.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: render-inventory.mjs <cache>");
const cache = resolve(arg),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = await Bun.file(
    `${cache}/research/inventory-comparison.json`,
  ).arrayBuffer(),
  proof = JSON.parse(new TextDecoder().decode(raw)),
  catalog = await Bun.file(`${cache}/public/latest-items/package.json`).json(),
  images = new Map(),
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
    );
if (
  sha(
    await Bun.file(`${cache}/public/latest-items/package.json`).arrayBuffer(),
  ) !== proof.itemAssetsSha256
)
  throw Error("Item assets changed since inspection");
for (const id of proof.observedItemIds) {
  const a = catalog.items[id],
    png = await Bun.file(
      `${cache}/public/latest-items/${a.icon}`,
    ).arrayBuffer();
  if (sha(png) !== a.iconSha256) throw Error("Item icon changed");
  images.set(
    a.iconSha256,
    `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
  );
}
const rows = [];
let y = 180;
for (let i = 0; i < proof.cases.length; i += 2) {
  rows.push(y);
  y +=
    Math.max(...proof.cases.slice(i, i + 2).map((c) => c.drawing.height)) + 88;
}
const height = y + 170,
  parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${height}"><rect width="1600" height="${height}" fill="#09131d"/><g font-family="Arial" fill="#e4edf4">`,
    '<text x="55" y="64" font-size="35" font-weight="bold">Recorded inventory and installed item icons</text>',
    '<text x="55" y="108" font-size="20" fill="#9cb1c4">Actual panel drawing commands · absolute replay time · item stacks and recorded slot swaps</text>',
    '<text x="55" y="140" font-size="18" fill="#9cb1c4">Slots 1–7 are the standard inventory; nonempty auxiliary slots follow on the next row.</text>',
  ];
for (const [i, c] of proof.cases.entries()) {
  const x = 55 + (i % 2) * 770,
    top = rows[Math.floor(i / 2)];
  parts.push(
    `<text x="${x}" y="${top}" font-size="23" fill="#59d9b3">${esc(c.label)}</text>`,
    `<g transform="translate(${x},${top + 20})">${inspectionPanelSvg(c.drawing, images)}</g>`,
  );
}
parts.push(
  `<text x="55" y="${y + 28}" font-size="21">${proof.counts.slotChecks.toLocaleString()} native slot observations · ${proof.counts.reverseSeekChecks.toLocaleString()} reverse-seek checks · ${proof.counts.observedItems} observed item IDs</text>`,
  `<text x="55" y="${y + 70}" font-size="18" fill="#9cb1c4">Icons come from the installed client. Charge/cooldown semantics, KDA, CS and XP progression remain unresolved.</text>`,
  `<text x="55" y="${y + 108}" font-size="18" fill="#9cb1c4">Offscreen component render; browser gestures, full-match coverage and matching League A/V remain unverified.</text></g></svg>`,
);
const svg = parts.join(""),
  png = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
  })
    .render()
    .asPng(),
  out = `${cache}/public/evidence/latest-inventory`;
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
console.log(
  JSON.stringify({
    image: `${out}.png`,
    imageSha256: sha(png),
    width: 1600,
    height,
  }),
);
