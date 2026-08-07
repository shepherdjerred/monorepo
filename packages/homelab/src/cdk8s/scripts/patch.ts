#!/usr/bin/env bun

// Files that may contain Intel GPU resources
const filesToPatch = [
  "dist/media.k8s.yaml",
  "dist/pokemon.k8s.yaml",
  "dist/mario-kart.k8s.yaml",
];

console.log("🔧 Applying Intel GPU resource patches...");

const invalidGpuResource =
  /^([ \t]*)gpu\.intel\.com\/i915: (?:null|0|'0'|"0")$/gm;

for (const file of filesToPatch) {
  const source = await Bun.file(file).text();
  const patched = source.replaceAll(
    invalidGpuResource,
    "$1gpu.intel.com/i915: 1",
  );
  await Bun.write(file, patched);
  console.log(`✓ Patched Intel GPU resources in ${file}`);
}

console.log("🎉 Intel GPU resource patches applied successfully!");
