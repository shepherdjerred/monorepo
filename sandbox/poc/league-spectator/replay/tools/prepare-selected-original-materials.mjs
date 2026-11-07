// Explicitly select existing fixed-approved complete materials; never rewrite them.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  PARENT_QUAD_GPU_SHA,
  PARENT_TRAIL_GPU_SHA,
  PARENT_EROSION_GPU_SHA,
} from "../latest-parent-material-contract.mjs";
import { SELECTED_MATERIAL_POLICY } from "../latest-selected-materials.mjs";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: prepare-selected-original-materials.mjs <cache>");
const root = resolve(cacheArg, "public"),
  read = async (p) =>
    new Uint8Array(await Bun.file(`${root}/${p}`).arrayBuffer()),
  parse = (b) => JSON.parse(new TextDecoder().decode(b));
const manifest = await read("latest-effects/manifest.json"),
  hash = await sha256(manifest),
  expected = [
    ["quadGpu", "latest-complete-quad-gpu/package.json", PARENT_QUAD_GPU_SHA],
    ["trailGpu", "latest-trail-particles/gpu.json", PARENT_TRAIL_GPU_SHA],
    [
      "erosionGpu",
      "latest-quad-erosion-gpu/package.json",
      PARENT_EROSION_GPU_SHA,
    ],
  ],
  files = {};
for (const [role, path, sha] of expected) {
  const bytes = await read(path),
    p = parse(bytes);
  if (
    (await sha256(bytes)) !== sha ||
    p.effectsManifestSha256 !== hash ||
    p.build !== "16.21.829.8620" ||
    p.protocol !== "20e09df23c66b85e"
  )
    throw Error("Exact original complete material closure required: " + role);
  files[path] = { sha256: sha, bytes: bytes.length };
}
const data = {
  schema: 1,
  kind: "selected-original-material-capability-inventory",
  policy: SELECTED_MATERIAL_POLICY,
  mode: "fixed-original-complete",
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  effectsManifestSha256: hash,
  quadGpuSha256: PARENT_QUAD_GPU_SHA,
  trailGpuSha256: PARENT_TRAIL_GPU_SHA,
  erosionGpuSha256: PARENT_EROSION_GPU_SHA,
};
await Bun.write(
  `${root}/latest-selected-materials/package.json`,
  JSON.stringify(data, null, 2),
);
console.log(
  JSON.stringify({
    mode: data.mode,
    packageSha256: await sha256(
      await read("latest-selected-materials/package.json"),
    ),
    originalPackageHashes: files,
  }),
);
