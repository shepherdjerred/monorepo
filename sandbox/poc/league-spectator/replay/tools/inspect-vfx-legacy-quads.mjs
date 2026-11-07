import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestVfxLegacyQuads } from "../latest-vfx-legacy-quads.mjs";

const [packagePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-vfx-legacy-quads.mjs <decoder> <native-evidence> <comparison>",
  );
const root = resolve(packagePath),
  vendor = resolve(dirname(root), "vendor"),
  profile = await Bun.file(`${root}/profile.json`).json(),
  definitionBytes = await Bun.file(
    `${root}/vfx-legacy-quads.json`,
  ).arrayBuffer(),
  meta = JSON.parse(new TextDecoder().decode(definitionBytes)),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  spawnBytes = await Bun.file(`${root}/vfx-spawn.json`).arrayBuffer(),
  emitterBytes = await Bun.file(`${root}/vfx-emitter.json`).arrayBuffer(),
  image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
  runtimeBytes = await Bun.file(
    `${vendor}/unicorn_x86_candidate.mjs`,
  ).arrayBuffer(),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
if (
  hash(definitionBytes) !== profile.vfxLegacyQuadsSha256 ||
  native.definitionSha256 !== hash(definitionBytes) ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  hash(runtimeBytes) !== meta.runtimeSha256
)
  throw Error("Legacy quad comparison source mismatch");
for (const [name, digest] of Object.entries({
  ...meta.compilerSources,
  ...native.compilerSources,
}))
  if (
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
    digest
  )
    throw Error(`Stale legacy quad compiler ${name}`);
if (
  hash(
    await Bun.file(
      new URL("observe-vfx-legacy-quads.py", import.meta.url),
    ).arrayBuffer(),
  ) !== native.observerSha256
)
  throw Error("Stale legacy quad observer");
const { default: createUnicorn } = await import(
    pathToFileURL(`${vendor}/unicorn_x86_candidate.mjs`).href
  ),
  uc = await createUnicorn(),
  mismatches = [],
  timings = [];
const canonical = (v) =>
  JSON.stringify(v, (_k, n) =>
    typeof n === "number" && Object.is(n, -0)
      ? "negative-zero"
      : n && typeof n === "object" && !Array.isArray(n)
        ? Object.fromEntries(
            Object.entries(n).sort(([a], [b]) => a.localeCompare(b)),
          )
        : n,
  );
let uvRenders = 0,
  checkpointFrames = 0,
  crossGraphRestores = 0;
let frames = 0,
  births = 0,
  vertices = 0,
  indices = 0,
  repeatFrames = 0;
for (const ref of meta.templates) {
  const kernel = await createLatestVfxLegacyQuads(
    uc,
    profile,
    image,
    spawnBytes,
    emitterBytes,
    definitionBytes,
    await Bun.file(`${root}/${ref.file}`).arrayBuffer(),
  );
  const cases = native.cases.filter((c) => c.graphSha256 === ref.sha256);
  try {
    for (const c of cases) {
      kernel.reset(BigInt(`0x${c.seedHex}`), 0);
      const saved = [];
      for (const [i, f] of c.frames.entries()) {
        const begin = performance.now(),
          actual = kernel.frame(f.input);
        timings.push(performance.now() - begin);
        frames++;
        births += actual.state.births.length;
        vertices += actual.geometry.verticesHex.length / 56;
        indices += actual.geometry.indicesHex.length / 4;
        if (canonical(actual) !== canonical(f.output))
          mismatches.push({
            graphSha256: ref.sha256,
            mode: c.mode,
            frame: i,
            keys: Object.keys(actual.state).filter(
              (k) =>
                canonical(actual.state[k]) !== canonical(f.output.state[k]),
            ),
            geometry:
              canonical(actual.geometry) !== canonical(f.output.geometry),
          });
        if ([0, 4, 8].includes(i))
          saved.push({ index: i, handle: kernel.checkpoint() });
        const k = kernel.kernel;
        const ownedDigest = () =>
          canonical([
            hash(k.read(0x10020000, 0x10000)),
            hash(k.read(0x10400000, k.nextHeap - 0x10400000)),
            hash(k.read(k.base + 0x2516698, 8)),
          ]);
        const before = ownedDigest();
        for (const uv of f.uvOutputs) {
          if (
            canonical(kernel.renderGeometry(f.input.viewPosition, uv.input)) !==
            canonical(uv.geometry)
          )
            mismatches.push({
              kind: "UV-composition",
              graphSha256: ref.sha256,
              mode: c.mode,
              frame: i,
            });
          if (ownedDigest() !== before)
            throw Error("UV-only rendering altered persistent state");
          uvRenders++;
        }
      }
      for (const savedState of saved) {
        kernel.restore(savedState.handle);
        for (let i = savedState.index + 1; i < c.frames.length; i++) {
          const f = c.frames[i];
          if (canonical(kernel.frame(f.input)) !== canonical(f.output))
            mismatches.push({
              kind: "checkpoint",
              graphSha256: ref.sha256,
              mode: c.mode,
              frame: i,
            });
          checkpointFrames++;
        }
        kernel.releaseCheckpoint(savedState.handle);
      }
    }
    const c = cases[0];
    kernel.reset(BigInt(`0x${c.seedHex}`), 0);
    for (const [i, f] of c.frames.entries()) {
      if (canonical(kernel.frame(f.input)) !== canonical(f.output))
        mismatches.push({
          kind: "reset-order",
          graphSha256: ref.sha256,
          frame: i,
        });
      repeatFrames++;
    }
    kernel.reset(BigInt(`0x${c.seedHex}`), 0);
    kernel.frame(c.frames[0].input);
    const saved = kernel.checkpoint(),
      other = meta.templates.find((t) => t.sha256 !== ref.sha256),
      graph = await kernel.loadGraph(
        await Bun.file(`${root}/${other.file}`).arrayBuffer(),
      );
    kernel.selectGraph(graph);
    kernel.reset(847n, 0);
    kernel.frame(c.frames[0].input);
    kernel.restore(saved);
    for (let i = 1; i < c.frames.length; i++) {
      if (
        canonical(kernel.frame(c.frames[i].input)) !==
        canonical(c.frames[i].output)
      )
        mismatches.push({
          kind: "cross-graph-restore",
          graphSha256: ref.sha256,
          frame: i,
        });
      crossGraphRestores++;
    }
    kernel.releaseCheckpoint(saved);
  } finally {
    kernel.close();
  }
}
const sources = Object.fromEntries(
  await Promise.all(
    [
      "latest-vfx-legacy-quads.mjs",
      "latest-vfx-spawn.mjs",
      "latest-vfx-emitter.mjs",
      "native-decoder.mjs",
    ].map(async (name) => [
      name,
      hash(
        await Bun.file(new URL(`../${name}`, import.meta.url)).arrayBuffer(),
      ),
    ]),
  ),
);
const result = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  definitionSha256: hash(definitionBytes),
  nativeSha256: hash(nativeBytes),
  runtimeSha256: hash(runtimeBytes),
  inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  observerSha256: native.observerSha256,
  sources,
  graphs: meta.templates.length,
  cases: native.cases.length,
  frames,
  births,
  vertices,
  indices,
  repeatFrames,
  uvRenders,
  checkpointFrames,
  crossGraphRestores,
  originalBlocks: native.originalBlocks.length,
  executableGlobalWrites: native.executableGlobalWrites,
  mismatches,
  timings,
  scope: meta.scope,
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    graphs: result.graphs,
    cases: result.cases,
    frames,
    births,
    vertices,
    indices,
    repeatFrames,
    uvRenders,
    checkpointFrames,
    crossGraphRestores,
    mismatches: mismatches.length,
    firstMismatch: mismatches[0],
  }),
);
if (mismatches.length) process.exitCode = 1;
