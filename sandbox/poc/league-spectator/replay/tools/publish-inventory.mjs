import { resolve, dirname } from "node:path";
import { INVENTORY_SHA } from "../latest-inventory.mjs";
import { ITEM_ASSETS_SHA } from "../latest-item-assets.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: publish-inventory.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  comparisonPath = `${cache}/research/inventory-comparison.json`,
  proof = await json(comparisonPath),
  visual = await json(`${assets}/evidence/latest-inventory.json`),
  native = await json(`${cache}/research/inventory-native.json`),
  owned = await json(`${cache}/research/inventory-state-native.json`),
  itemProof = await json(`${cache}/research/item-assets-native.json`),
  report = await json(`${cache}/research/latest-semantics-inventory.json`),
  meta = await json(`${assets}/latest-inventory/package.json`),
  catalog = await json(`${assets}/latest-items/package.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  c = proof.counts;
check(
  sha(await raw(`${assets}/latest-inventory/package.json`)) === INVENTORY_SHA &&
    native.packageSha256 === INVENTORY_SHA &&
    proof.packageSha256 === INVENTORY_SHA &&
    report.inventoryPackageSha256 === INVENTORY_SHA &&
    sha(await raw(`${assets}/latest-items/package.json`)) === ITEM_ASSETS_SHA &&
    proof.itemAssetsSha256 === ITEM_ASSETS_SHA &&
    meta.decoderImageSha256 === sha(image) &&
    proof.nativeEvidenceSha256 ===
      sha(await raw(`${cache}/research/inventory-native.json`)) &&
    proof.ownedStateEvidenceSha256 ===
      sha(await raw(`${cache}/research/inventory-state-native.json`)) &&
    proof.inspectorSha256 ===
      sha(await raw(`${root}/tools/inspect-inventory.mjs`)) &&
    visual.comparisonSha256 === sha(await raw(comparisonPath)) &&
    visual.rendererSha256 ===
      sha(await raw(`${root}/tools/render-inventory.mjs`)) &&
    visual.imageSha256 ===
      sha(await raw(`${assets}/evidence/latest-inventory.png`)) &&
    visual.svgSha256 ===
      sha(await raw(`${assets}/evidence/latest-inventory.svg`)) &&
    JSON.stringify(c) === JSON.stringify(visual.counts),
  "Inventory proof/visual is stale",
);
for (const [record, preparer] of [
  [native, "prepare-inventory.py"],
  [owned, "observe-inventory-state.py"],
  [itemProof, "prepare-item-assets.py"],
]) {
  check(
    record.preparerSha256 === sha(await raw(`${root}/tools/${preparer}`)),
    "Native inventory preparer changed",
  );
  for (const [name, h] of Object.entries(record.sources ?? {}))
    check(
      sha(await raw(`${root}/tools/${name}`)) === h,
      "Native inventory helper changed",
    );
  for (const b of record.originalBlocks ?? [])
    check(
      sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
      "Original inventory code changed",
    );
}
for (const [p, h] of Object.entries(proof.inputs))
  check(sha(await raw(p)) === h, `Inventory evidence input changed: ${p}`);
for (const [p, h] of Object.entries(proof.sources))
  check(sha(await raw(`${root}/${p}`)) === h, `Inventory source changed: ${p}`);
check(
  c.structuralPackets === 3888 &&
    c.inventoryPackets === 113 &&
    c.entryChecks === 238 &&
    c.wireProbeChecks === 768 &&
    c.slotChecks === 1130 &&
    c.snapshotChecks === 1100 &&
    c.reverseSeekChecks === 1100 &&
    c.canvasChecks === 1100 &&
    c.worldChecks === 48 &&
    c.observedItems === 26 &&
    c.catalogItems === 863 &&
    c.catalogIcons === 610 &&
    c.legacyChecks === 43 &&
    c.edgeCases === 4 &&
    c.rejectionChecks === 17 &&
    report.inventoryEvents.length === 113 &&
    proof.scope.nativeSlotPrimitivesExecuted &&
    proof.scope.nativeApiIdentityCountRead &&
    proof.scope.mainViewerSourceIntegrated &&
    proof.scope.installedItemIconsPrepared &&
    !proof.scope.browserRun &&
    !proof.scope.leagueAvCompared &&
    !proof.scope.completeInventoryRuntimeExecuted &&
    !proof.scope.opaqueScalarB4RuntimeVerified &&
    !proof.scope.counterB2SemanticsVerified &&
    !proof.scope.wholeMatchInventoryVerified,
  "Inventory verification coverage incomplete",
);
const build = await Bun.build({
  entrypoints: [
    `${root}/latest-viewer.mjs`,
    `${root}/structural-check-worker.mjs`,
  ],
  target: "browser",
  external: ["three", "/assets/*"],
});
check(
  build.success && build.outputs.length === 2,
  `Viewer/worker build failed: ${build.logs.join("\n")}`,
);
const paths = new Map(),
  visited = new Set();
async function include(file) {
  if (visited.has(file)) return;
  visited.add(file);
  paths.set(`/${file.slice(root.length + 1).replaceAll("\\", "/")}`, file);
  for (const m of (await Bun.file(file).text()).matchAll(
    /(?:from\s*|import\s*\()\s*["'](\.\.?\/[^"']+\.mjs)["']/g,
  ))
    await include(resolve(dirname(file), m[1]));
}
await include(`${root}/latest-viewer.mjs`);
await include(`${root}/structural-check-worker.mjs`);
for (const name of ["latest.html", "README.md", "AV-FIDELITY-MAP.md"])
  paths.set(`/${name}`, `${root}/${name}`);
for (const name of [
  "latest-inventory/package.json",
  "latest-items/package.json",
  "latest-experience/package.json",
  "latest-world-state/package.json",
  "latest-champion-state/package.json",
  "latest-replication/package.json",
  "latest-scene/manifest.json",
  "decoder-16.21-macos/profile.json",
  "decoder-16.21-macos/image.bin",
  "decoder-16.21-macos/constructors.bin",
  "evidence/latest-inventory.png",
  "evidence/latest-inventory.svg",
  "evidence/latest-inventory.json",
])
  paths.set(`/assets/${name}`, `${assets}/${name}`);
for (const id of proof.observedItemIds) {
  const a = catalog.items[id];
  paths.set(
    `/assets/latest-items/${a.icon}`,
    `${assets}/latest-items/${a.icon}`,
  );
}
for (const name of [
  "inventory-native.json",
  "inventory-state-native.json",
  "inventory-comparison.json",
  "inventory-objects-comparison.json",
  "item-assets-native.json",
  "latest-semantics-inventory.json",
]) {
  const dest = `${assets}/evidence/${name}`;
  await Bun.write(dest, await raw(`${cache}/research/${name}`));
  paths.set(`/assets/evidence/${name}`, dest);
}
const files = await Promise.all(
    [...paths].map(async ([path, file]) => ({
      path,
      sha256: sha(await raw(file)),
    })),
  ),
  checks = [];
for (const origin of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
]) {
  let cursor = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, async () => {
      while (cursor < files.length) {
        const item = files[cursor++],
          r = await fetch(`${origin}${item.path}`, {
            signal: AbortSignal.timeout(30000),
          });
        check(
          r.status === 200 && sha(await r.arrayBuffer()) === item.sha256,
          `HTTP inventory delivery differs: ${origin}${item.path}`,
        );
        checks.push({ url: `${origin}${item.path}`, sha256: item.sha256 });
      }
    }),
  );
  for (const r of results) if (r.status === "rejected") throw r.reason;
}
await Bun.write(
  `${cache}/research/inventory-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      publisherSha256: sha(await raw(import.meta.path)),
      comparisonSha256: sha(await raw(comparisonPath)),
      imageSha256: visual.imageSha256,
      counts: c,
      scope: proof.scope,
      checks: checks.sort((a, b) => a.url.localeCompare(b.url)),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ matchedFiles: checks.length, counts: c }));
