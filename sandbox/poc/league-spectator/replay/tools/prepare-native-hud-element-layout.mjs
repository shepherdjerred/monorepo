import { sha256 } from "../structural-comparison.mjs";

const [basePath, nativePath, inventoryPath, output] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: prepare-native-hud-element-layout.mjs <proved-layout-package.json> <native-element-layout-controls.json> <element-inventory.json> <output.json>",
  );
const baseBytes = await Bun.file(basePath).bytes(),
  nativeBytes = await Bun.file(nativePath).bytes(),
  inventoryBytes = await Bun.file(inventoryPath).bytes(),
  base = JSON.parse(new TextDecoder().decode(baseBytes)),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  inventory = JSON.parse(new TextDecoder().decode(inventoryBytes));
if (
  base.schema !== 1 ||
  base.kind !== "native-hud-root-layout" ||
  (await sha256(baseBytes)) !==
    "52cb834d62ca6ee596eca30494524ab58f97aa51f8e0dde7384f7ff7ffa622e1" ||
  native.kind !== "original-authored-hud-root-parent-layout-control" ||
  inventory.kind !== "original-ui-base-element-position-inventory" ||
  native.imageSha256 !== base.imageSha256 ||
  native.anchorsSha256 !== base.nativeObservation.anchorsSha256
)
  throw Error(
    "Existing proved HUD program and complete original element inventory required",
  );
const sorted = (blocks) => [...blocks].sort((a, b) => a.rva - b.rva);
if (
  JSON.stringify(sorted(native.originalBlocks)) !==
  JSON.stringify(sorted(base.sourceBlocks))
)
  throw Error(
    "Element coverage entered an unproved original HUD program block",
  );
for (const [file, expected] of [
  ["observe-native-hud-layouts.py", native.sourceSha256],
  ["ui_manager_native.py", native.nativeHelperSha256],
  ["inventory-native-hud-element-layouts.py", inventory.sourceSha256],
])
  if (
    (await sha256(await Bun.file(new URL(file, import.meta.url)).bytes())) !==
    expected
  )
    throw Error("Native element layout producer changed");
const expected = new Map();
for (const group of inventory.controllers)
  for (const binding of group.bindings)
    for (const match of binding.matches)
      for (const layout of match.layout) {
        const key = `${match.sourceSha256}:${match.objectHash}:${layout.path}`;
        if (expected.has(key))
          throw Error("Duplicate original element position");
        expected.set(key, layout.authored);
      }
if (!expected.size || expected.size !== native.observations.length)
  throw Error("Native element rectangle coverage is incomplete");
for (const row of native.observations) {
  const key = `${row.source.sourceSha256}:${row.source.objectHash}:${row.source.layoutPath}`;
  if (
    !expected.has(key) ||
    JSON.stringify(expected.get(key)) !==
      JSON.stringify(row.source.authoredPosition) ||
    row.results.length !== 4 ||
    row.results.some(
      (value) =>
        value.originalOutputRect.length !== 4 ||
        !value.originalOutputRect.every(Number.isFinite),
    )
  )
    throw Error("Native layout output lost an original element position");
  expected.delete(key);
}
if (expected.size) throw Error("Unobserved original element rectangle");
const manifest = {
  ...base,
  nativeObservation: {
    ...base.nativeObservation,
    sha256: await sha256(nativeBytes),
    rectangles: native.observations.length,
    viewportObservations: native.observations.reduce(
      (sum, row) => sum + row.results.length,
      0,
    ),
    elementInventorySha256: await sha256(inventoryBytes),
  },
  coverageScope:
    "Complete source UI-base element positions including authored button-state children; exact same previously proved native root-parent/default-settings program",
};
await Bun.write(output, JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify({
    output,
    rectangles: native.observations.length,
    sourceBlocks: manifest.sourceBlocks.length,
    sha256: await sha256(await Bun.file(output).bytes()),
  }),
);
