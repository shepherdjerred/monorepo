// Publish the verified optional draw-prefix extension and controlled GPU image.
// Static preparation only; no additional replay lifecycle is enabled here.
import { resolve } from "node:path";
import {
  PARENT_DRAW_CACHES_SHA,
  PARENT_DRAW_PARAMETERS_SHA,
} from "../latest-parent-draw-parameters.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  directory = `${assets}/latest-parent-draw-caches`,
  inputs = {},
  files = new Map(),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  catalog = await read(`${directory}/package.json`),
  cpu = await read(`${cache}/research/parent-draw-parameters-comparison.json`),
  worker = await read(`${cache}/research/parent-draw-parameters-workers.json`),
  uniforms = await read(
    `${cache}/research/parent-frame-uniforms-comparison.json`,
  ),
  fixture = await read(`${cache}/research/parent-draw-gallery.json`),
  visual = await read(`${assets}/evidence/latest-parent-draw-parameters.json`);
check(
  sha(await raw(`${directory}/package.json`)) === PARENT_DRAW_CACHES_SHA &&
    catalog.caches.length === 14 &&
    !catalog.scope.containsReplayEvents,
  "Pinned static draw caches required",
);
check(
  sha(await raw(`${assets}/latest-parent-draw-parameters/package.json`)) ===
    PARENT_DRAW_PARAMETERS_SHA,
  "Pinned original draw ABI required",
);
for (const proof of [cpu, worker])
  check(
    proof.mismatchCount === 0 &&
      proof.counts.roots === 14 &&
      proof.counts.parameterRecords === 664 &&
      proof.counts.binaryRecords === 166 &&
      proof.counts.worldRestorations === 28 &&
      proof.scope.originalPrefixAndParameterBytes &&
      !proof.scope.browserExecuted,
    "Complete draw prefix CPU and worker comparisons required",
  );
check(
  uniforms.mismatchCount === 0 &&
    uniforms.counts.nativeBlocks === 664 &&
    uniforms.counts.preparedBlocks === 1328 &&
    uniforms.scope.integratedMaterialBlocksCompared,
  "Original native frame packing comparison required",
);
check(
  fixture.counts.preparedRoots === 12 &&
    fixture.counts.boundaryRoots === 2 &&
    fixture.counts.drawRecords === 69 &&
    !fixture.scope.replayPlayback,
  "Controlled complete-root fixture required",
);
check(
  visual.kind === "original-parent-draw-parameter-offscreen-snapshots" &&
    visual.counts.drawnRoots === 12 &&
    visual.counts.visibleRoots === 9 &&
    visual.counts.zeroPixelRoots === 3 &&
    visual.counts.boundaryRoots === 2 &&
    visual.counts.draws === 69 &&
    visual.counts.frameUniformGpuReadbacks === 276 &&
    visual.scope.originalDrawPrefixParametersApplied &&
    visual.scope.frameUniformGpuReadbackCompared &&
    !visual.scope.browserExecuted &&
    !visual.scope.referenceCompared,
  "Scoped original-parameter GPU image required",
);
for (const proof of [cpu, worker, uniforms, fixture, visual]) {
  const base = proof === visual ? `${root}/tools` : root;
  for (const [name, digest] of Object.entries(proof.sources))
    check(
      sha(await raw(`${base}/${name}`)) === digest,
      `Draw source changed: ${name}`,
    );
  for (const [path, digest] of Object.entries(proof.inputs))
    check(sha(await raw(path)) === digest, `Draw input changed: ${path}`);
}
const modules = [
  "latest-parent-draw-parameters.mjs",
  "latest-parent-frame-uniforms.mjs",
  "latest-parent-frames.mjs",
  "latest-parent-worker.mjs",
  "latest-parent-worker-client.mjs",
];
const build = await Bun.build({
  entrypoints: modules.map((n) => `${root}/${n}`),
  target: "browser",
  write: false,
});
check(build.success, "Original draw extension browser bundles failed");
async function add(url, path, digest) {
  const b = await raw(path);
  check(!digest || sha(b) === digest, `Draw publication bytes differ: ${url}`);
  check(
    !files.has(url) || files.get(url).sha256 === sha(b),
    "Conflicting draw publication URL",
  );
  files.set(url, { sha256: sha(b), bytes: b.length });
}
for (const name of modules) await add(`/${name}`, `${root}/${name}`);
await add(
  "/assets/latest-parent-draw-parameters/package.json",
  `${assets}/latest-parent-draw-parameters/package.json`,
  PARENT_DRAW_PARAMETERS_SHA,
);
await add(
  "/assets/latest-parent-draw-caches/package.json",
  `${directory}/package.json`,
  PARENT_DRAW_CACHES_SHA,
);
for (const ref of catalog.caches) {
  check(/^[a-z0-9-]+\.json$/.test(ref.file), "Invalid draw cache filename");
  const record = await read(`${directory}/${ref.file}`);
  check(
    record.effectId === ref.effectId &&
      record.drawParameters &&
      record.scope.warmParentSuspended &&
      !record.scope.containsReplayEvents,
    "Owned static draw cache required",
  );
  await add(
    `/assets/latest-parent-draw-caches/${ref.file}`,
    `${directory}/${ref.file}`,
    ref.sha256,
  );
  for (const segment of [...record.segments, ...record.imagePatches]) {
    check(
      /^[a-z0-9-]+\.bin$/.test(segment.file),
      "Invalid draw CPU page filename",
    );
    await add(
      `/assets/latest-parent-draw-caches/${segment.file}`,
      `${directory}/${segment.file}`,
      segment.sha256,
    );
  }
}
for (const extension of ["png", "json"])
  await add(
    `/assets/evidence/latest-parent-draw-parameters.${extension}`,
    `${assets}/evidence/latest-parent-draw-parameters.${extension}`,
    extension === "png" ? visual.imageSha256 : undefined,
  );
let httpChecks = 0;
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
]) {
  const entries = [...files];
  let next = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, async () => {
      while (next < entries.length) {
        const [url, ref] = entries[next++],
          response = await fetch(base + url, {
            signal: AbortSignal.timeout(15000),
          });
        check(
          response.status === 200,
          `Draw static HTTP ${response.status}: ${base}${url}`,
        );
        check(
          sha(new Uint8Array(await response.arrayBuffer())) === ref.sha256,
          `Draw HTTP content differs: ${base}${url}`,
        );
        httpChecks++;
      }
    }),
  );
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
  console.log(JSON.stringify({ base, files: files.size, httpChecks }));
}
await Bun.write(
  `${cache}/research/parent-draw-parameters-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "private-original-parent-draw-parameter-publication",
      inputs,
      files: Object.fromEntries(files),
      counts: { files: files.size, httpChecks },
      scope: {
        originalDrawPrefixCompared: true,
        realWorkersCompared: true,
        browserBundlesBuilt: true,
        offscreenGpuReadbackCompared: true,
        mainViewerEnabled: false,
        browserExecuted: false,
        replayLifecycleMapping: false,
        referenceCompared: false,
      },
    },
    null,
    2,
  ),
);
