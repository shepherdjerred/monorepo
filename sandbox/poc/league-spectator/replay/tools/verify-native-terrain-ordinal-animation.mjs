// Offline authored clip proof. The output remains local and clip selection here
// is a test input, independent of replay animation authority.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readOriginalRigOrdinalSource } from "./ordinal-model-layout.mjs";
import { createOrdinalClipSampler } from "./research/native-terrain-animation.mjs";
import { openLocalWad } from "./wad.mjs";

const [
  installation,
  models,
  auditPath,
  champion,
  name,
  exporter,
  threePath,
  out,
  ...extra
] = process.argv.slice(2);
if (!out || extra.length)
  throw Error(
    "Usage: bun verify-native-terrain-ordinal-animation.mjs <exact installation> <ordinal models folder> <animation audit.json> <champion> <authored clip name> <AnimationPack.dll> <three.core.js> <fresh proof directory>",
  );

const sha = (bytes) =>
  createHash("sha256")
    .update(
      new Uint8Array(
        bytes.buffer ?? bytes,
        bytes.byteOffset ?? 0,
        bytes.byteLength,
      ),
    )
    .digest("hex");
const file = (path) => Bun.file(path).arrayBuffer();
const checked = async (path, expected) => {
  const bytes = await file(path);
  if (sha(bytes) !== expected) throw Error("Digest mismatch: " + path);
  return bytes;
};
const manifest = JSON.parse(
  await readFile(join(models, "manifest.json"), "utf8"),
);
const audit = JSON.parse(await readFile(auditPath, "utf8"));
const actor = audit.actors.find((entry) => entry.champion === champion);
const model = manifest.actors.find((entry) => entry.context === actor?.context);
const clip = actor?.probes[name];
const expectedExe =
  "89d73a9e6d886c291f5b3cf42904e5e8b014148b56490d2b6c862ea96cc9f156";
if (
  audit.build !== "16.23.840.6595" ||
  manifest.build !== audit.build ||
  manifest.protocol !== audit.protocol ||
  manifest.replaySha256 !== audit.replaySha256 ||
  manifest.sourceManifestSha256 !== audit.championManifestSha256 ||
  manifest.installedExeSha256 !== expectedExe ||
  audit.executableSha256 !== expectedExe ||
  model?.skinId !== actor?.skinId ||
  model?.champion !== champion ||
  clip?.classHash !== "5bd9a1e6" ||
  clip.magic !== "r3d2anmd" ||
  clip.version !== 5
)
  throw Error(
    "Matching exact ordinal model and audited atomic v5 clip required",
  );
await checked(join(installation, "Game", "League of Legends.exe"), expectedExe);
const directory = `${champion.toLowerCase()}-${actor.skinId}`;
const modelBytes = await checked(
  join(models, model.model.file),
  model.model.sha256,
);
const bindings = JSON.parse(
  new TextDecoder().decode(
    await checked(
      join(models, model.jointBindings.file),
      model.jointBindings.sha256,
    ),
  ),
);
if (bindings.modelSha256 !== model.model.sha256)
  throw Error("Ordinal model binding identity differs");
const rigBytes = await checked(
  join(models, "work", directory, "model.skl"),
  bindings.rigSha256,
);
const rig = readOriginalRigOrdinalSource(new Uint8Array(rigBytes));
const wad = await openLocalWad(
  installation,
  `DATA/FINAL/Champions/${champion}.wad.client`,
  Bun.zstdDecompressSync,
);
const source =
  clip.resource.type === "WadChunkLink"
    ? await wad.byHash(BigInt(clip.resource.value))
    : await wad(clip.resource.value);
if (sha(source) !== clip.sha256 || source.byteLength !== clip.bytes)
  throw Error("Authored animation digest differs from exact graph audit");
const assembly = await checked(
  join(dirname(exporter), "LeagueToolkit.dll"),
  manifest.toolchain.assemblies["LeagueToolkit.dll"],
);
const staging = await mkdtemp(
  join(resolve(out, ".."), "ordinal-animation-staging-"),
);
const clipDir = join(staging, "clips");
const planPath = join(staging, "plan.json");
await Promise.all([
  writeFile(join(staging, "model.skl"), new Uint8Array(rigBytes)),
  writeFile(join(staging, "authored.anm"), source),
  writeFile(
    join(staging, "selected-clips.json"),
    JSON.stringify({ [name]: "authored.anm" }),
  ),
]);
const child = Bun.spawn(
  ["dotnet", resolve(exporter), staging, clipDir, planPath],
  {
    cwd: tmpdir(),
    stdout: "pipe",
    stderr: "pipe",
  },
);
const [stdout, stderr, status] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
if (status !== 0)
  throw Error(`Exact v5 export failed (${status}): ${stdout}\n${stderr}`);
const plan = JSON.parse(await readFile(planPath, "utf8"));
const record = plan.records[0];
if (
  plan.rigSha256 !== bindings.rigSha256 ||
  plan.records.length !== 1 ||
  record.sourceSha256 !== clip.sha256 ||
  record.status !== "prepared" ||
  record.evaluator !== "pinned-toolkit-uncompressed"
)
  throw Error("Packed ordinal samples differ from verified source");
const packed = await file(join(clipDir, "0.clip"));
const THREE = await import(pathToFileURL(resolve(threePath)).href);
const sampler = createOrdinalClipSampler(
  THREE,
  modelBytes,
  bindings,
  rig,
  packed,
);
const times = [0, sampler.duration * 0.233, sampler.duration * 0.711, 0];
const poses = times.map((time) => sampler.sample(time));
if (poses.some((pose) => !pose.every(Number.isFinite)))
  throw Error("Non-finite authored palette");
const digests = poses.map(sha);
if (new Set(digests).size !== 3 || digests[0] !== digests[3])
  throw Error("Authored palette movement or deterministic rewind proof failed");
const proof = {
  build: audit.build,
  champion,
  skinId: model.skinId,
  participantId: model.footerRow,
  context: actor.context,
  replaySha256: audit.replaySha256,
  skinScale: model.skinScale,
  hiddenRanges: model.hiddenRanges,
  clip: name,
  sourceSha256: clip.sha256,
  modelSha256: model.model.sha256,
  rigSha256: bindings.rigSha256,
  packedSha256: sha(packed),
  exporterSha256: sha(await file(exporter)),
  samplerLibrarySha256: sha(assembly),
  duration: sampler.duration,
  fps: sampler.fps,
  frames: sampler.frames,
  trackCount: sampler.trackCount,
  paletteSize: sampler.paletteSize,
  samples: times.map((time, index) => ({
    seconds: time,
    sha256: digests[index],
  })),
};
await mkdir(out);
await Promise.all([
  writeFile(join(out, "authored.clip"), new Uint8Array(packed)),
  writeFile(join(out, "rig.skl"), new Uint8Array(rigBytes)),
  writeFile(join(out, "proof.json"), JSON.stringify(proof, null, 2) + "\n"),
]);
console.log(JSON.stringify(proof));
