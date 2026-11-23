// Extend a closed authored-content selection with independently approved build
// programs and its exact scene's packet/world programs. Existing sources and
// receipts stay immutable; no runtime role falls back to an older asset tree.
import path from "node:path";
import { realpath } from "node:fs/promises";
import { sha256 } from "../structural-comparison.mjs";
import { SELECTED_BUILD_PROGRAMS } from "./selected-build-programs.mjs";
import { UNIT_RESOURCES_PACKAGE_SHA } from "../latest-unit-resources.mjs";
import { INITIAL_RESOURCE_PREFIX_PACKAGE_SHA } from "../latest-initial-resource-prefix-contract.mjs";
import { NEGATIVE_FORM_PREFIX_PACKAGE_SHA } from "../latest-negative-form-prefix-contract.mjs";
import { approvedWorldStateReferenceSha } from "../latest-world-state-contract.mjs";
import { approvedCorpsePolicyReferenceSha } from "../latest-corpse-contract.mjs";
import { approvedEffectPacketReferenceSha } from "../latest-effect-packet-contract.mjs";
import { NEUTRAL_CREATION_PACKAGE_SHA } from "../latest-neutral-creation.mjs";
import { validateSelectedStaticSourcePlan } from "./selected-static-sources.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [configurationFile, outputFile, effectsSourceRoot] =
  process.argv.slice(2);
if (!outputFile || ![4, 5].includes(process.argv.length))
  throw Error(
    "Usage: bun extend-selected-scene-session-config.mjs <authored-content-configuration.json> <fresh-configuration.json> [exact-effects-source-root]",
  );
if (await Bun.file(outputFile).exists())
  throw Error("Fresh session configuration required");
const inputs = {};
async function raw(file) {
  file = path.resolve(file);
  const bytes = await Bun.file(file).bytes(),
    digest = await sha256(bytes);
  if (inputs[file] && inputs[file] !== digest)
    throw Error("Session configuration source changed");
  inputs[file] = digest;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const config = decode(await raw(configurationFile));
validateSelectedStaticSourcePlan(config.plan);
if (Object.keys(config).sort().join("|") !== "plan|roles|roots")
  throw Error("Explicit authored-content source configuration required");
async function source(authority, file) {
  if (
    !/^[-A-Za-z0-9_./]+$/.test(file) ||
    file.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw Error("Bounded session source path required");
  const root = await realpath(path.resolve(config.roots[authority])),
    target = await realpath(path.join(root, file));
  const fold = (v) => (process.platform === "win32" ? v.toLowerCase() : v);
  if (!fold(target).startsWith(fold(root + path.sep)))
    throw Error("Session source escaped its explicit authority");
  return raw(target);
}
async function selected(file) {
  const ref = config.plan.files[file];
  if (!ref) throw Error("Selected source missing: " + file);
  const bytes = await source(ref.source.authority, ref.source.file);
  if (bytes.length !== ref.bytes || (await sha256(bytes)) !== ref.sha256)
    throw Error("Selected source declaration differs: " + file);
  return bytes;
}
const profile = decode(await selected("decoder-16.21-macos/profile.json")),
  sceneBytes = await selected(config.roles.scene),
  scene = decode(sceneBytes),
  sceneSha256 = await sha256(sceneBytes),
  worldSha256 = await sha256(await selected("latest-scene/" + scene.world));
if (
  scene.map?.id !== 11 ||
  scene.build !== profile.clientVersion ||
  scene.protocol !== profile.protocolDigest
)
  throw Error("Exact selected Summoner's Rift scene/build required");
let added = 0;
async function declare(
  file,
  authority,
  expected,
  role = null,
  sourceFile = file,
) {
  const bytes = await source(authority, sourceFile),
    digest = await sha256(bytes);
  if (digest !== expected)
    throw Error("Independently approved session program differs: " + file);
  const entry = {
      source: { authority, file: sourceFile },
      sha256: digest,
      bytes: bytes.length,
    },
    previous = config.plan.files[file];
  if (previous && JSON.stringify(previous) !== JSON.stringify(entry))
    throw Error("Existing session source conflicts: " + file);
  if (!previous) {
    config.plan.files[file] = entry;
    added++;
  }
  if (role !== null) {
    if (config.roles[role] !== undefined && config.roles[role] !== file)
      throw Error("Existing session role conflicts: " + role);
    config.roles[role] = file;
  }
}
for (const [file, expected] of SELECTED_BUILD_PROGRAMS)
  await declare(file, "build", expected);
for (const [name, key] of [
  ["vfx-values", "vfxValuesSha256"],
  ["vfx-birth", "vfxBirthSha256"],
  ["vfx-emission", "vfxEmissionSha256"],
  ["vfx-samplers", "vfxSamplersSha256"],
  ["missile-motion", "missileMotionSha256"],
  ["missile-controllers", "missileControllersSha256"],
  ["missile-actors", "missileActorsSha256"],
])
  await declare(`decoder-16.21-macos/${name}.json`, "build", profile[key]);
for (const [file, expected, role] of [
  [
    "latest-unit-resources/package.json",
    UNIT_RESOURCES_PACKAGE_SHA,
    "unitResources",
  ],
  [
    "latest-initial-resource-prefix/package.json",
    INITIAL_RESOURCE_PREFIX_PACKAGE_SHA,
    "initialResourcePrefix",
  ],
  [
    "latest-negative-form-prefix/package.json",
    NEGATIVE_FORM_PREFIX_PACKAGE_SHA,
    "negativeFormPrefix",
  ],
])
  await declare(file, "build", expected, role);
for (const [file, expected, role] of [
  [
    "latest-world-state/package.json",
    approvedWorldStateReferenceSha(11, worldSha256),
    "worldState",
  ],
  [
    "latest-corpse/package.json",
    approvedCorpsePolicyReferenceSha(11, worldSha256),
    "corpsePolicy",
  ],
  [
    "latest-effect-placement/package.json",
    approvedEffectPacketReferenceSha("placement", 11, sceneSha256),
    "effectPlacement",
  ],
  [
    "latest-effect-descriptor/package.json",
    approvedEffectPacketReferenceSha("descriptor", 11, sceneSha256),
    "effectDescriptor",
  ],
  [
    "latest-neutral-creation/package.json",
    NEUTRAL_CREATION_PACKAGE_SHA,
    "neutralCreation",
  ],
])
  await declare(file, "scene", expected, role);
// Reference roles have distinct declared paths under the catalog contract.
// They retain the same original, independently approved source bytes rather
// than manufacturing a document or substituting a different scene's package.
for (const [role, reference, target] of [
  ["worldState", "worldStateReference", "world-state-reference"],
  ["corpsePolicy", "corpsePolicyReference", "corpse-policy-reference"],
  ["effectPlacement", "effectPlacementReference", "effect-placement-reference"],
  [
    "effectDescriptor",
    "effectDescriptorReference",
    "effect-descriptor-reference",
  ],
]) {
  const file = config.roles[role],
    ref = config.plan.files[file];
  await declare(
    `latest-static-catalog/${target}.json`,
    ref.source.authority,
    ref.sha256,
    reference,
    ref.source.file,
  );
}
if (effectsSourceRoot !== undefined) {
  const authority = "effectsSource";
  if (
    config.plan.sources[authority] ||
    config.roots[authority] ||
    config.roles.effectsSource
  )
    throw Error("Fresh explicitly selected effects-source authority required");
  config.roots[authority] = await realpath(path.resolve(effectsSourceRoot));
  const manifestBytes = await source(authority, "manifest.json"),
    manifest = decode(manifestBytes),
    ref = manifest.files?.[0],
    expectedEffects = config.plan.files[config.roles.effects].sha256;
  if (
    manifest.schema !== 1 ||
    manifest.kind !== "archived-map11-effects-source-authority" ||
    manifest.build !== profile.clientVersion ||
    manifest.protocol !== profile.protocolDigest ||
    manifest.sceneManifestSha256 !== sceneSha256 ||
    manifest.effectsManifestSha256 !== expectedEffects ||
    manifest.nativeSpectatorAdmitted !== false ||
    manifest.files?.length !== 1 ||
    ref?.file !== "package.json"
  )
    throw Error("Exact selected scene/effects source authority required");
  const packageBytes = await source(authority, ref.file),
    metadata = decode(packageBytes);
  if (
    packageBytes.length !== ref.bytes ||
    (await sha256(packageBytes)) !== ref.sha256 ||
    metadata.schema !== 1 ||
    metadata.kind !== "archived-map11-partial-effects-source" ||
    metadata.build !== profile.clientVersion ||
    metadata.protocol !== profile.protocolDigest ||
    metadata.sceneManifestSha256 !== sceneSha256 ||
    metadata.effectsManifestSha256 !== expectedEffects ||
    metadata.nativeSpectatorAdmitted !== false
  )
    throw Error("Declared original effects-source package differs");
  config.plan.sources[authority] = {
    kind: "prepared-scene-package",
    identity: {
      file: "manifest.json",
      bytes: manifestBytes.length,
      sha256: await sha256(manifestBytes),
    },
  };
  await declare(
    "effects-source/manifest.json",
    authority,
    await sha256(manifestBytes),
    null,
    "manifest.json",
  );
  await declare(
    "effects-source/package.json",
    authority,
    ref.sha256,
    "effectsSource",
    "package.json",
  );
}
validateSelectedStaticSourcePlan(config.plan);
for (const [file, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(file).bytes())) !== digest)
    throw Error("Session program authority changed during declaration");
await Bun.write(outputFile, JSON.stringify(config));
await Bun.write(
  outputFile + ".proof.json",
  JSON.stringify(
    {
      kind: "closed-scene-session-program-declarations",
      added,
      inputs,
      sceneSha256,
      worldSha256,
      nativeSpectatorAdmitted: false,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    outputFile,
    added,
    files: Object.keys(config.plan.files).length,
    roles: Object.keys(config.roles).length,
    nativeSpectatorAdmitted: false,
  }),
);
