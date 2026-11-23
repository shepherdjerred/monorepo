import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";
import { SUBMESH_VISIBILITY_SHA } from "../latest-submesh-visibility-contract.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [sourceArgument, sceneArgument, outputArgument, pythonArgument] =
  process.argv.slice(2);
if (!outputArgument || process.argv.length > 6)
  throw Error(
    "Usage: bun prepare-scene-submesh-visibility.mjs <approved-source-cache> <closed-common-scene> <archive-cache> [python]",
  );
const { sourceCache, out, work } = await createStaticPreparationOutput(
    sourceArgument,
    outputArgument,
    { prefix: "scene-submesh-", directory: "scene-submesh" },
  ),
  inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function raw(file) {
  const bytes = await Bun.file(file).bytes(),
    key = path.resolve(file),
    digest = sha(bytes);
  if (inputs[key] && inputs[key] !== digest)
    throw Error("Submesh source changed during preparation");
  inputs[key] = digest;
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const sceneRoot = path.resolve(sceneArgument),
  sceneBytes = await raw(path.join(sceneRoot, "manifest.json")),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes)),
  profileBytes = await raw(
    path.join(sourceCache, "public/decoder-16.21-macos/profile.json"),
  ),
  profile = JSON.parse(new TextDecoder().decode(profileBytes)),
  reference = await raw(
    path.join(sourceCache, "public/latest-submesh-visibility/package.json"),
  );
if (
  scene.kind !== "archived-map11-common-runtime-scene" ||
  scene.map?.id !== 11 ||
  scene.build !== profile.clientVersion ||
  scene.protocol !== profile.protocolDigest ||
  sha(reference) !== SUBMESH_VISIBILITY_SHA
)
  throw Error(
    "Closed exact scene and preserved original submesh reference required",
  );
const inventory = new Map(scene.files.map((entry) => [entry.path, entry]));
if (inventory.size !== scene.files.length)
  throw Error("Duplicate closed scene resource");
async function sceneFile(file) {
  sceneAnimationFilePath(file);
  const expected = inventory.get(file),
    bytes = await raw(path.join(sceneRoot, file));
  if (
    !expected ||
    expected.bytes !== bytes.length ||
    expected.sha256 !== sha(bytes)
  )
    throw Error(`Closed submesh source differs: ${file}`);
  return bytes;
}
const worldBytes = await sceneFile(scene.world),
  world = JSON.parse(new TextDecoder().decode(worldBytes)),
  stage = path.join(work, "native-stage");
await mkdir(path.join(stage, "research"), { recursive: true });
async function stageFile(file, bytes) {
  await Bun.write(path.join(stage, "public", file), bytes);
}
await stageFile("latest-scene/manifest.json", sceneBytes);
await stageFile(`latest-scene/${scene.world}`, worldBytes);
const assets = [
  ...Object.values(scene.champions),
  ...Object.values(world.assets).filter((asset) => asset.animationGraph),
];
for (const asset of assets)
  for (const file of [
    asset.animationGraph,
    asset.model,
    asset.model.replace(/\.glb$/, ".skn"),
  ])
    await stageFile(`latest-scene/${file}`, await sceneFile(file));
await stageFile("decoder-16.21-macos/profile.json", profileBytes);
for (const [file, digest] of [
  ["image.bin", profile.decoderImageSha256],
  ["vfx-birth.json", profile.vfxBirthSha256],
  ["vfx-values.json", profile.vfxValuesSha256],
]) {
  const bytes = await raw(
    path.join(sourceCache, "public/decoder-16.21-macos", file),
  );
  if (sha(bytes) !== digest)
    throw Error(`Original native submesh dependency differs: ${file}`);
  await stageFile(`decoder-16.21-macos/${file}`, bytes);
}
const tools = fileURLToPath(new URL("./", import.meta.url)),
  python =
    pythonArgument ??
    path.join(sourceCache, "research/venv/Scripts/python.exe"),
  client = path.join(sourceCache, "research/LeagueofLegends-macos");
await raw(python);
await raw(client);
async function run(command, name) {
  const process = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" }),
    [code, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
  await Bun.write(path.join(work, `${name}.log`), stdout + stderr);
  if (code !== 0)
    throw Error(
      `Original submesh ${name} failed (${code}): ${stderr.slice(-4000)}`,
    );
}
await run(
  [
    python,
    "-B",
    path.join(tools, "prepare-submesh-visibility.py"),
    stage,
    client,
  ],
  "native",
);
await run(
  [
    process.execPath,
    path.join(tools, "inspect-selected-submesh-native.mjs"),
    stage,
    path.join(sourceCache, "public/latest-submesh-visibility/package.json"),
  ],
  "comparison",
);
const files = [];
for (const [name, source] of [
  ["package.json", "public/latest-submesh-visibility/package.json"],
  ["native.json", "research/submesh-visibility-native.json"],
  ["comparison.json", "research/selected-submesh-comparison.json"],
]) {
  const bytes = await raw(path.join(stage, source));
  await Bun.write(path.join(out, name), bytes);
  files.push({ path: name, bytes: bytes.length, sha256: sha(bytes) });
}
for (const [file, digest] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error(`Submesh input changed before publication: ${file}`);
const scope = {
  originalComponentObserved: true,
  completeSceneAssetInventory: true,
  nativeAnimationControllerRecovered: false,
  graphicsSubmissionVerified: false,
  nativeSpectatorAdmitted: false,
};
await Bun.write(
  path.join(work, "proof.json"),
  JSON.stringify({ schema: 1, inputs, scope }, null, 2),
);
const manifest = {
  schema: 1,
  kind: "scene-submesh-visibility-resources",
  build: scene.build,
  protocol: scene.protocol,
  decoderImageSha256: profile.decoderImageSha256,
  sceneManifestSha256: sha(sceneBytes),
  fixedReferenceSha256: SUBMESH_VISIBILITY_SHA,
  roles: {
    submeshVisibility: "package.json",
    submeshVisibilityProof: "native.json",
    submeshVisibilityComparison: "comparison.json",
  },
  files,
  scope,
};
await Bun.write(
  path.join(out, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  JSON.stringify({
    output: out,
    assets: assets.length,
    manifestSha256: sha(
      await Bun.file(path.join(out, "manifest.json")).bytes(),
    ),
    scope,
  }),
);
