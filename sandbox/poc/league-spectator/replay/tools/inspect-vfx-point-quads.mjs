import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestVfxPointQuads } from "../latest-vfx-point-quads.mjs";
const [packagePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-vfx-point-quads.mjs <decoder> <native> <comparison>",
  );
const root = resolve(packagePath),
  profile = await Bun.file(`${root}/profile.json`).json(),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = await Bun.file(`${root}/vfx-point-quads.json`).arrayBuffer(),
  meta = JSON.parse(new TextDecoder().decode(raw)),
  nativeRaw = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeRaw)),
  image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
  vendor = resolve(dirname(root), "vendor/unicorn_x86_candidate.mjs"),
  canonical = (v) =>
    JSON.stringify(v, (_k, n) =>
      typeof n === "number" && Object.is(n, -0)
        ? "negative-zero"
        : n && typeof n === "object" && !Array.isArray(n)
          ? Object.fromEntries(
              Object.entries(n).sort(([a], [b]) => a.localeCompare(b)),
            )
          : n,
    );
if (
  native.definitionSha256 !== hash(raw) ||
  native.decoderImageSha256 !== hash(image) ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  hash(await Bun.file(vendor).arrayBuffer()) !== meta.runtimeSha256 ||
  hash(
    await Bun.file(
      new URL("observe-vfx-point-quads.py", import.meta.url),
    ).arrayBuffer(),
  ) !== native.observerSha256
)
  throw Error("Point-quad native evidence mismatch");
for (const [name, digest] of Object.entries({
  ...meta.compilerSources,
  ...native.compilerSources,
}))
  if (
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
    digest
  )
    throw Error(`Stale point compiler ${name}`);
for (const b of native.originalBlocks)
  if (hash(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
    throw Error("Point observed code changed");
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  uc = await createUnicorn(),
  kernel = await createLatestVfxPointQuads(
    uc,
    profile,
    image,
    await Bun.file(`${root}/vfx-spawn.json`).arrayBuffer(),
    await Bun.file(`${root}/vfx-emitter.json`).arrayBuffer(),
    raw,
    await Bun.file(`${root}/${meta.templates[0].file}`).arrayBuffer(),
  ),
  handles = new Map(),
  mismatches = [];
let frames = 0,
  births = 0,
  vertices = 0,
  indices = 0,
  checkpointFrames = 0,
  crossGraphRestores = 0,
  repeatFrames = 0;
try {
  for (const ref of meta.templates)
    handles.set(
      ref.sha256,
      await kernel.loadGraph(
        await Bun.file(`${root}/${ref.file}`).arrayBuffer(),
      ),
    );
  for (const [ci, c] of native.cases.entries()) {
    kernel.selectGraph(handles.get(c.graphSha256));
    kernel.reset(BigInt(`0x${c.seedHex}`), 0);
    const saved = [];
    for (const [i, f] of c.frames.entries()) {
      const actual = kernel.frame(f.input);
      frames++;
      births += actual.state.births.length;
      vertices += actual.geometry.verticesHex.length / 56;
      indices += actual.geometry.indicesHex.length / 4;
      if (canonical(actual) !== canonical(f.output))
        mismatches.push({ case: ci, frame: i, kind: "forward" });
      if ([0, 4, 8].includes(i))
        saved.push({ frame: i, handle: kernel.checkpoint() });
    }
    for (const s of saved) {
      kernel.restore(s.handle);
      for (let i = s.frame + 1; i < c.frames.length; i++) {
        if (
          canonical(kernel.frame(c.frames[i].input)) !==
          canonical(c.frames[i].output)
        )
          mismatches.push({ case: ci, frame: i, kind: "checkpoint" });
        checkpointFrames++;
      }
      kernel.releaseCheckpoint(s.handle);
    }
    kernel.reset(BigInt(`0x${c.seedHex}`), 0);
    kernel.frame(c.frames[0].input);
    const birth = kernel.checkpoint(),
      other = meta.templates.find((r) => r.sha256 !== c.graphSha256);
    kernel.selectGraph(handles.get(other.sha256));
    kernel.reset(789n, 0);
    kernel.frame(c.frames[0].input);
    kernel.restore(birth);
    for (let i = 1; i < c.frames.length; i++) {
      if (
        canonical(kernel.frame(c.frames[i].input)) !==
        canonical(c.frames[i].output)
      )
        mismatches.push({ case: ci, frame: i, kind: "cross-graph" });
      crossGraphRestores++;
    }
    kernel.releaseCheckpoint(birth);
    kernel.reset(BigInt(`0x${c.seedHex}`), 0);
    for (const f of c.frames) {
      if (canonical(kernel.frame(f.input)) !== canonical(f.output))
        mismatches.push({ case: ci, kind: "reset" });
      repeatFrames++;
    }
  }
} finally {
  kernel.close();
}
const sources = Object.fromEntries(
    await Promise.all(
      [
        "latest-vfx-point-quads.mjs",
        "latest-vfx-legacy-quads.mjs",
        "latest-vfx-spawn.mjs",
        "latest-vfx-emitter.mjs",
        "native-decoder.mjs",
      ].map(async (n) => [
        n,
        hash(await Bun.file(new URL(`../${n}`, import.meta.url)).arrayBuffer()),
      ]),
    ),
  ),
  result = {
    schema: 1,
    build: meta.build,
    protocol: meta.protocol,
    definitionSha256: hash(raw),
    nativeEvidenceSha256: hash(nativeRaw),
    inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
    observerSha256: native.observerSha256,
    sources,
    graphs: meta.templates.length,
    cases: native.cases.length,
    frames,
    births,
    vertices,
    indices,
    checkpointFrames,
    crossGraphRestores,
    repeatFrames,
    originalBlocks: native.originalBlocks.length,
    executableGlobalWrites: native.executableGlobalWrites,
    mismatchCount: mismatches.length,
    mismatches: mismatches.slice(0, 15),
    scope: meta.scope,
  };
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({ ...result, sources: undefined, scope: undefined }),
);
if (mismatches.length) process.exitCode = 1;
