// Verify private preview assets over HTTP, including every additional CPU page.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  assets = `${cache}/public`,
  root = resolve(import.meta.dir, ".."),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => Bun.file(p).bytes(),
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  native = await read(`${cache}/research/effect-root-frames-native.json`),
  wasm = await read(`${cache}/research/effect-root-frames-wasm.json`),
  flow = await read(`${cache}/research/effect-root-renderer.json`),
  visual = await read(`${assets}/evidence/latest-effect-root-frames.json`),
  files = new Map();
if (
  wasm.mismatchCount ||
  flow.mismatchCount ||
  !wasm.scope.allPreparedRootsCompared ||
  wasm.counts.roots !== native.counts.returningRoots ||
  flow.counts.roots !== visual.counts.panels ||
  visual.counts.liveDrivePixelResponses < 1 ||
  visual.scope.browserExecuted ||
  flow.scope.browserExecuted
)
  throw Error("Requested-root evidence is incomplete or overstated");
for (const [report, directory] of [
  [wasm, root],
  [flow, root],
  [native, `${root}/tools`],
]) {
  for (const [name, digest] of Object.entries(report.sources))
    if (sha(await raw(`${directory}/${name}`)) !== digest)
      throw Error(`Changed root source: ${name}`);
  for (const [path, digest] of Object.entries(report.inputs))
    if (sha(await raw(path)) !== digest)
      throw Error(`Changed root input: ${path}`);
}
for (const [path, digest] of Object.entries(visual.inputs))
  if (sha(await raw(path)) !== digest)
    throw Error(`Changed root visual input: ${path}`);
if (
  visual.rendererSha256 !==
  sha(await raw(`${root}/tools/render-effect-root-frames.py`))
)
  throw Error("Changed root visual producer");
async function add(url, path, expected) {
  const b = await raw(path),
    digest = sha(b);
  if (expected && digest !== expected)
    throw Error(`Changed static root asset: ${url}`);
  if (files.has(url) && files.get(url).sha256 !== digest)
    throw Error("Conflicting root asset URL");
  files.set(url, { sha256: digest, bytes: b.length });
}
const catalog = await read(
  `${assets}/latest-effect-root-frame-caches/package.json`,
);
await add(
  "/assets/latest-effect-root-frame-caches/package.json",
  `${assets}/latest-effect-root-frame-caches/package.json`,
  wasm.cachePackageSha256,
);
for (const ref of catalog.caches) {
  const path = `${assets}/latest-effect-root-frame-caches/${ref.file}`;
  await add(
    `/assets/latest-effect-root-frame-caches/${ref.file}`,
    path,
    ref.sha256,
  );
  const c = await read(path);
  if (
    c.scope.containsReplayEvents ||
    c.scope.portableBrowserGraphicsHandles ||
    !c.scope.warmParentSuspended
  )
    throw Error("Root cache scope changed");
  for (const segment of [...c.segments, ...c.imagePatches])
    await add(
      `/assets/latest-effect-root-frame-caches/${segment.file}`,
      `${assets}/latest-effect-root-frame-caches/${segment.file}`,
      segment.sha256,
    );
}
const textures = await read(
  `${assets}/latest-effect-root-textures/package.json`,
);
await add(
  "/assets/latest-effect-root-textures/package.json",
  `${assets}/latest-effect-root-textures/package.json`,
);
for (const ref of Object.values(textures.textures))
  await add(
    `/assets/latest-effect-root-textures/${ref.file}`,
    `${assets}/latest-effect-root-textures/${ref.file}`,
    ref.sha256,
  );
await add(
  "/assets/latest-quad-erosion-gpu/package.json",
  `${assets}/latest-quad-erosion-gpu/package.json`,
);
for (const file of [
  "latest-parent-frames.mjs",
  "latest-parent-worker.mjs",
  "latest-parent-render-frame.mjs",
  "latest-parent-renderer.mjs",
])
  await add(`/${file}`, `${root}/${file}`);
for (const file of [
  "latest-effect-root-frames.json",
  "latest-effect-root-frames.png",
])
  await add(
    `/assets/evidence/${file}`,
    `${assets}/evidence/${file}`,
    file.endsWith("png") ? visual.image.sha256 : undefined,
  );
const jobs = [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
].flatMap((base) =>
  [...files].map(([url, ref]) => ({ url: base + url, ...ref })),
);
let next = 0,
  checked = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++],
        response = await fetch(job.url, { signal: AbortSignal.timeout(30000) });
      if (response.status !== 200)
        throw Error(`Root preview HTTP ${response.status}: ${job.url}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== job.bytes || sha(bytes) !== job.sha256)
        throw Error(`Root preview bytes differ: ${job.url}`);
      checked++;
    }
  }),
);
const result = {
  schema: 1,
  kind: "requested-root-private-publication",
  counts: { files: files.size, httpChecks: checked },
  files: Object.fromEntries(files),
  scope: {
    privateTailnetOnly: true,
    localAndTailnetBytesCompared: true,
    browserExecuted: false,
    matchLifecycleMapping: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/effect-root-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result.counts));
