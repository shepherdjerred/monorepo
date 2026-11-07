import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestAnimationAttachments } from "../latest-animation-attachments.mjs";
import { createLatestAnimationRigBindings } from "../latest-animation-rigs.mjs";

const [packagePath, nativePath, outputPath, scenePath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-animation-attachments.mjs <decoder> <native> <comparison> [scene]",
  );
const root = resolve(packagePath),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  profile = await Bun.file(`${root}/profile.json`).json(),
  raw = await Bun.file(`${root}/animation-attachments.json`).arrayBuffer(),
  meta = JSON.parse(new TextDecoder().decode(raw)),
  nativeRaw = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeRaw)),
  image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
  vendor = resolve(dirname(root), "vendor/unicorn_x86_candidate.mjs");
const scene = scenePath
    ? resolve(scenePath)
    : resolve(dirname(root), "latest-scene"),
  rigBytes = await Bun.file(`${root}/animation-rigs.json`).arrayBuffer(),
  rigs = JSON.parse(new TextDecoder().decode(rigBytes)),
  rigFactory = await createLatestAnimationRigBindings(profile, rigBytes),
  rigBindings = new Map();
if (
  native.definitionSha256 !== hash(raw) ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  hash(await Bun.file(vendor).arrayBuffer()) !== meta.runtimeSha256
)
  throw Error("Attachment observation source mismatch");
for (const [name, digest] of Object.entries({
  ...native.compilerSources,
  ...meta.compilerSources,
}))
  if (
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
    digest
  )
    throw Error(`Stale attachment compiler ${name}`);
for (const block of native.executedOriginalBlocks)
  if (hash(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
    throw Error("Attachment observed block differs from image");
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  uc = await createUnicorn(),
  kernel = await createLatestAnimationAttachments(
    uc,
    profile,
    image,
    await Bun.file(`${root}/vfx-spawn.json`).arrayBuffer(),
    raw,
  ),
  mismatches = [],
  counts = {};
let requests = 0,
  retained = 0,
  rigJoinedCases = 0;
const canonical = (v) =>
  JSON.stringify(v, (_k, n) =>
    n && typeof n === "object" && !Array.isArray(n)
      ? Object.fromEntries(
          Object.entries(n).sort(([a], [b]) => a.localeCompare(b)),
        )
      : n,
  );
try {
  for (const [i, c] of native.cases.entries()) {
    let input = c.input;
    if (c.actor) {
      const actor = meta.actors[c.actor],
        rig = rigs.graphs[actor.graphFile];
      if (!rigBindings.has(c.actor))
        rigBindings.set(
          c.actor,
          await rigFactory.bind(
            actor.graphFile,
            await Bun.file(`${scene}/${rig.rigFile}`).arrayBuffer(),
            await Bun.file(`${scene}/${rig.catalogFile}`).arrayBuffer(),
          ),
        );
      const byHash = new Map(c.input.joints.map((j) => [j.hash, j])),
        transforms = rig.joints.map((j) => byHash.get(j.fnvHash).transformHex),
        joints = rigBindings.get(c.actor).attachmentJoints(transforms);
      if (canonical(joints) !== canonical(c.input.joints))
        throw Error(
          "Authored attachment inputs differ from original-constructed rig bindings",
        );
      input = { ...c.input, joints };
      rigJoinedCases++;
    }
    const actual = {
      activation: kernel.activate(input),
      cleanup: kernel.cleanup(),
      emptyCleanup: kernel.cleanup(),
    };
    retained += actual.activation.retained;
    for (const phase of ["activation", "cleanup", "emptyCleanup"]) {
      if (canonical(actual[phase]) !== canonical(c[phase]))
        mismatches.push({
          case: i,
          phase,
          actual: actual[phase],
          expected: c[phase],
        });
      for (const request of actual[phase].requests) {
        requests++;
        counts[request.kind] = (counts[request.kind] ?? 0) + 1;
      }
    }
  }
} finally {
  kernel.close();
}
const result = {
  schema: 1,
  build: meta.build,
  protocol: meta.protocol,
  definitionSha256: hash(raw),
  nativeEvidenceSha256: hash(nativeRaw),
  runtimeSha256: meta.runtimeSha256,
  decoderImageSha256: profile.decoderImageSha256,
  moduleSha256: hash(
    await Bun.file(
      new URL("../latest-animation-attachments.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  executorSha256: hash(
    await Bun.file(
      new URL("../latest-vfx-spawn.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  animationRigsSha256: hash(rigBytes),
  rigModuleSha256: hash(
    await Bun.file(
      new URL("../latest-animation-rigs.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  rigJoinedCases,
  inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  cases: native.cases.length,
  phases: native.cases.length * 3,
  originalBlocks: native.executedOriginalBlocks.length,
  requests,
  retained,
  requestKinds: counts,
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 20),
  scope: meta.scope,
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    cases: result.cases,
    phases: result.phases,
    requests,
    retained,
    originalBlocks: result.originalBlocks,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) process.exitCode = 1;
