import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestAnimationWorldPoses } from "../latest-animation-world-poses.mjs";
import { createLatestAnimationRigBindings } from "../latest-animation-rigs.mjs";
import { createLatestAnimationEvents } from "../latest-animation-events.mjs";
import { createLatestAnimationAttachments } from "../latest-animation-attachments.mjs";
import { createLatestVfxPointQuads } from "../latest-vfx-point-quads.mjs";
import { createAnimationPointSequence } from "../latest-animation-point-sequence.mjs";
import { readAnimationAsset } from "../latest-animation.mjs";
const [packagePath, scenePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-animation-point-sequence.mjs <decoder> <scene> <native> <comparison>",
  );
const root = resolve(packagePath),
  scene = resolve(scenePath),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  read = (name) => Bun.file(`${root}/${name}`).arrayBuffer(),
  profile = await Bun.file(`${root}/profile.json`).json(),
  nativeRaw = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeRaw)),
  image = new Uint8Array(await read("image.bin")),
  spawn = await read("vfx-spawn.json"),
  worldBytes = await read("animation-world-poses.json"),
  worldMeta = JSON.parse(new TextDecoder().decode(worldBytes)),
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
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  native.decoderImageSha256 !== hash(image) ||
  hash(await Bun.file(vendor).arrayBuffer()) !==
    "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716"
)
  throw Error("Sequence build mismatch");
for (const [key, digest] of Object.entries(native.packages))
  if (profile[key] !== digest)
    throw Error("Sequence package dependency changed");
for (const [name, digest] of Object.entries(native.compilerSources))
  if (
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
    digest
  )
    throw Error(`Stale sequence compiler ${name}`);
for (const block of native.originalBlocks)
  if (hash(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
    throw Error("Sequence original code changed");
const clipRaw = await Bun.file(
  resolve(dirname(root), "latest-animation-poses", native.clipFile),
).arrayBuffer();
if (hash(clipRaw) !== native.clipSha256)
  throw Error("Sequence local animation changed");
const clip = readAnimationAsset(clipRaw),
  graph = worldMeta.graphs[native.graph],
  hex = (raw) =>
    Array.from(raw, (n) => n.toString(16).padStart(2, "0")).join("");
for (const f of native.frames) {
  const local = graph.bindLocalHex.map((h) =>
    Uint8Array.from(h.match(/../g), (n) => parseInt(n, 16)),
  );
  for (const track of clip.tracks) {
    if (graph.joints[track.jointId] !== track.bone)
      throw Error("Sequence track/rig mismatch");
    const view = new DataView(local[track.jointId].buffer),
      at = { position: 0, scale: 12, quaternion: 24 }[track.channel],
      frame = track.count === 1 ? 0 : f.input.frame;
    for (let i = 0; i < track.width; i++)
      view.setFloat32(at + i * 4, track.values[frame * track.width + i], true);
  }
  if (canonical(local.map(hex)) !== canonical(f.input.localHex))
    throw Error("Sequence local pose source mismatch");
}
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  uc = await createUnicorn(),
  worldFactory = await createLatestAnimationWorldPoses(
    uc,
    profile,
    image,
    spawn,
    worldBytes,
  ),
  rigFactory = await createLatestAnimationRigBindings(
    profile,
    await read("animation-rigs.json"),
  ),
  rigRaw = await Bun.file(`${scene}/${graph.rigFile}`).arrayBuffer(),
  catalogRaw = await Bun.file(`${scene}/${graph.catalogFile}`).arrayBuffer(),
  world = await worldFactory.bind(native.graph, rigRaw, catalogRaw),
  rig = await rigFactory.bind(native.graph, rigRaw, catalogRaw),
  events = await createLatestAnimationEvents(
    uc,
    profile,
    image,
    spawn,
    await read("animation-events.json"),
  ),
  attachments = await createLatestAnimationAttachments(
    uc,
    profile,
    image,
    spawn,
    await read("animation-attachments.json"),
  ),
  quads = await createLatestVfxPointQuads(
    uc,
    profile,
    image,
    spawn,
    await read("vfx-emitter.json"),
    await read("vfx-point-quads.json"),
    await read(native.emitterRefs[0].file),
  ),
  emitters = await Promise.all(
    native.emitterRefs.map(async (r) => ({
      index: r.emitterIndex,
      handle: await quads.loadGraph(await read(r.file)),
    })),
  ),
  sequence = createAnimationPointSequence({
    events,
    world,
    rig,
    attachments,
    quads,
    eventSpec: native.eventSpec,
    activation: native.activation,
    emitters,
  }),
  mismatches = [];
let drawFrames = 0,
  vertices = 0,
  births = 0,
  activationFrames = [];
try {
  for (const [i, f] of native.frames.entries()) {
    const actual = sequence.step(f.input);
    if (canonical(actual) !== canonical(f.output))
      mismatches.push({
        frame: i,
        kind: "forward",
        keys: Object.keys(actual).filter(
          (k) => canonical(actual[k]) !== canonical(f.output[k]),
        ),
      });
    drawFrames += actual.draws.length;
    for (const d of actual.draws) {
      vertices += d.output.geometry.verticesHex.length / 56;
      births += d.output.state.births.length;
    }
    if (actual.attachmentRequests.length) activationFrames.push(f.input.frame);
  }
  if (canonical(sequence.reset()) !== canonical(native.cleanup))
    mismatches.push({ kind: "cleanup" });
  for (const [i, f] of native.frames.entries())
    if (canonical(sequence.step(f.input)) !== canonical(f.output))
      mismatches.push({ frame: i, kind: "resimulation" });
} finally {
  sequence.close();
  worldFactory.close();
  events.close();
  attachments.close();
  quads.close();
}
const names = [
    "latest-animation-point-sequence.mjs",
    "latest-animation-world-poses.mjs",
    "latest-animation-rigs.mjs",
    "latest-animation-events.mjs",
    "latest-animation-attachments.mjs",
    "latest-vfx-point-quads.mjs",
    "latest-vfx-legacy-quads.mjs",
    "latest-vfx-spawn.mjs",
    "latest-vfx-emitter.mjs",
    "latest-animation.mjs",
    "native-decoder.mjs",
  ],
  sources = Object.fromEntries(
    await Promise.all(
      names.map(async (n) => [
        n,
        hash(await Bun.file(new URL(`../${n}`, import.meta.url)).arrayBuffer()),
      ]),
    ),
  ),
  result = {
    schema: 1,
    build: native.build,
    protocol: native.protocol,
    nativeEvidenceSha256: hash(nativeRaw),
    inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
    sources,
    frames: native.frames.length,
    resimulatedFrames: native.frames.length,
    activationFrames,
    emitters: emitters.length,
    drawFrames,
    vertices,
    births,
    originalBlocks: native.originalBlocks.length,
    mismatchCount: mismatches.length,
    mismatches: mismatches.slice(0, 15),
    scope: native.scope,
  };
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({ ...result, sources: undefined, scope: undefined }),
);
if (mismatches.length) process.exitCode = 1;
