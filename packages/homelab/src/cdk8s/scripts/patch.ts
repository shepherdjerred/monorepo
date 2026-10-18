#!/usr/bin/env bun

import { workerPoolTemplate } from "./delivery/worker-pool-template.ts";

// Files that may contain Intel GPU resources
const filesToPatch = [
  "dist/arcade.k8s.yaml",
  "dist/media.k8s.yaml",
  "dist/pokemon.k8s.yaml",
  "dist/mario-kart.k8s.yaml",
  "dist/stash.k8s.yaml",
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

for (const chart of ["temporal", "scout-beta", "scout-prod"]) {
  const file = `dist/${chart}.k8s.yaml`;
  await Bun.write(file, workerPoolTemplate(await Bun.file(file).text(), chart));
}
