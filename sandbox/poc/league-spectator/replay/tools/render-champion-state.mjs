import { resolve } from "node:path";
import { Resvg } from "../../../packages/report/node_modules/@resvg/resvg-js/index.js";
import { championPlateSvg } from "../latest-overhead.mjs";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: render-champion-state.mjs <cache>");
const cache = resolve(arg),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = new Uint8Array(
    await Bun.file(
      `${cache}/research/champion-state-comparison.json`,
    ).arrayBuffer(),
  ),
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
    `<svg xmlns="http://www.w3.org/2000/svg" width="1900" height="1300"><rect width="1900" height="1300" fill="#09131d"/><g font-family="Arial" fill="#e4edf4">`,
    `<text x="60" y="65" font-size="35" font-weight="bold">Player names, levels and resources now follow replay state</text>`,
    `<text x="60" y="105" font-size="20" fill="#9cb1c4">Matching-build native schema and consumers · actual recorded values · same overhead drawing commands as the viewer</text>`,
  ];
for (const [col, time] of [0, 60, 105].entries()) {
  const x = 60 + col * 620;
  parts.push(
    `<text x="${x}" y="160" font-size="24" fill="#59d9b3">Replay time ${time}s</text>`,
  );
  for (const [i, c] of proof.cases
    .filter((c) => c.time === time && !c.transition)
    .entries()) {
    const y = 175 + i * 82,
      s = c.state;
    parts.push(
      `<g transform="translate(${x},${y})">${championPlateSvg(c.drawing)}</g>`,
    );
    const lines = s.dead
      ? [`${c.champion} · dead`]
      : [
          `${c.champion} · ${s.currentHealth.toFixed(1)} / ${s.maxHealth.toFixed(1)} HP`,
          c.drawing.resourceStatus === "continuous-preview"
            ? `Resource ${s.resourceValue.toFixed(1)} / ${s.resourceMax.toFixed(1)}`
            : `Resource: ${c.drawing.resourceStatus}`,
          `Current gold: ${s.currentGold === null ? "unavailable" : s.currentGold.toFixed(1)}`,
        ];
    for (const [j, line] of lines.entries())
      parts.push(
        `<text x="${x + 270}" y="${y + 25 + j * 21}" font-size="15" fill="#9cb1c4">${esc(line)}</text>`,
      );
  }
}
parts.push(
  `<text x="60" y="1040" font-size="23" font-weight="bold">Recorded death hides the entire overhead; respawn restores the sampled state</text>`,
);
for (const [i, c] of proof.cases.filter((c) => c.transition).entries()) {
  const x = 60 + i * 620,
    y = 1050;
  parts.push(
    `<g transform="translate(${x},${y})">${championPlateSvg(c.drawing)}</g><text x="${x + 270}" y="${y + 45}" font-size="17" fill="#9cb1c4">${c.time.toFixed(2)}s · ${c.state.dead ? "hidden" : "visible"}</text>`,
  );
}
parts.push(
  `<text x="60" y="1170" font-size="19">137 registered fields · ${proof.counts.groupChecks.toLocaleString()} native groups · ${proof.counts.consumerChecks.toLocaleString()} getter checks · ${proof.counts.reverseSeekChecks} reverse seeks</text>`,
  `<text x="60" y="1210" font-size="17" fill="#9cb1c4">Fonts, geometry, resource colors/segmentation and special resources remain approximate. Shields, items and XP are not yet presented.</text>`,
  `<text x="60" y="1250" font-size="17" fill="#9cb1c4">Offscreen component evidence. Actual browser scene submission and matching League A/V comparison remain unverified.</text></g></svg>`,
);
const svg = parts.join(""),
  png = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
  })
    .render()
    .asPng(),
  out = `${cache}/public/evidence/latest-champion-state`;
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
