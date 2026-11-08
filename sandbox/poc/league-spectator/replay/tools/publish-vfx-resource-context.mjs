// Publish exact-build activation component evidence; no browser execution claim.
import { resolve } from "node:path";
import { VFX_RESOURCE_CONTEXT_SHA } from "../latest-vfx-resource-context.mjs";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: publish-vfx-resource-context.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  meta = await read(`${assets}/latest-vfx-resource-context/package.json`),
  native = await read(`${cache}/research/vfx-resource-context-native.json`),
  comparison = await read(
    `${cache}/research/vfx-resource-context-comparison.json`,
  ),
  objects = await read(`${cache}/research/vfx-objects-comparison.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
check(
  sha(await raw(`${assets}/latest-vfx-resource-context/package.json`)) ===
    VFX_RESOURCE_CONTEXT_SHA &&
    native.packageSha256 === VFX_RESOURCE_CONTEXT_SHA &&
    comparison.packageSha256 === VFX_RESOURCE_CONTEXT_SHA &&
    native.counts.roots === 77 &&
    native.counts.activations === 234 &&
    comparison.counts.activations === 234 &&
    comparison.counts.contextChecks === 468 &&
    comparison.counts.parentBytes === 164736 &&
    comparison.counts.clockChecks === 234 &&
    comparison.counts.authoredChecks === 234 &&
    comparison.counts.rejections === 240 &&
    comparison.counts.boundaryChecks === 1 &&
    native.boundary.rva === 0x17e34c8 &&
    !comparison.scope.graphicsProvider &&
    !comparison.scope.mainViewerIntegrated,
  "Incomplete native/WASM resource-context evidence",
);
check(
  objects.counts.cases === 1984 &&
    objects.counts.objects === 2000 &&
    objects.counts.stageMismatches === 0 &&
    objects.counts.stateMismatches === 0 &&
    objects.counts.authoredMutations === 0,
  "Original object API comparison changed",
);
for (const record of [native, comparison, objects]) {
  for (const [path, h] of Object.entries(record.inputs))
    check(
      sha(await raw(path)) === h,
      `Resource evidence input changed: ${path}`,
    );
  for (const [name, h] of Object.entries(record.sources)) {
    const path =
      record === native ? `${root}/tools/${name}` : `${root}/${name}`;
    check(
      sha(await raw(path)) === h,
      `Resource evidence source changed: ${path}`,
    );
  }
}
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original resource code changed",
  );
check(sha(image) === meta.decoderImageSha256, "Resource decoder image changed");
const build = await Bun.build({
  entrypoints: [`${root}/latest-vfx-objects.mjs`],
  target: "browser",
  write: false,
});
check(build.success, "Native resource component browser build failed");
const files = new Map(),
  add = async (url, path) =>
    files.set(url, { path, sha256: sha(await raw(path)) });
for (const name of [
  "latest-vfx-resource-context.mjs",
  "latest-vfx-objects.mjs",
  "latest-vfx-spawn.mjs",
  "latest-vfx-system-assets.mjs",
  "latest-vfx-assets.mjs",
  "native-decoder.mjs",
  "structural-comparison.mjs",
])
  await add(`/${name}`, `${root}/${name}`);
await add(
  "/assets/latest-vfx-resource-context/package.json",
  `${assets}/latest-vfx-resource-context/package.json`,
);
for (const name of [
  "vfx-resource-context-native",
  "vfx-resource-context-comparison",
  "vfx-objects-comparison",
]) {
  const path = `${assets}/evidence/latest-${name}.json`;
  await Bun.write(path, await raw(`${cache}/research/${name}.json`));
  await add(`/assets/evidence/latest-${name}.json`, path);
}
let httpChecks = 0;
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
])
  for (const [url, ref] of files) {
    const response = await fetch(base + url, {
      signal: AbortSignal.timeout(30000),
    });
    check(
      response.status === 200 &&
        sha(new Uint8Array(await response.arrayBuffer())) === ref.sha256,
      `Resource preview HTTP differs: ${base + url}`,
    );
    httpChecks++;
  }
await Bun.write(
  `${cache}/research/vfx-resource-context-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "vfx-resource-context-preview-publication",
      publisherSha256: sha(await raw(import.meta.path)),
      packageSha256: VFX_RESOURCE_CONTEXT_SHA,
      httpChecks,
      files: Object.fromEntries(files),
      scope: {
        browserBuildPassed: true,
        localAndTailscaleBytesVerified: true,
        nativeWasmCompared: true,
        graphicsProvider: false,
        mainViewerIntegrated: false,
        browserRun: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    httpChecks,
    files: files.size,
    packageSha256: VFX_RESOURCE_CONTEXT_SHA,
  }),
);
