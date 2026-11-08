// Candidate inventory only: compiler support never substitutes for native
// selected material observations or actual placed/rendered instances.
import { resolve, sep } from "node:path";
import { compileLatestDirectEffect } from "../latest-direct-effect-definition.mjs";
import { createDirectEffectKernels } from "../latest-direct-effect-worker.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(
    process.argv[3] ?? `${cache}/public/latest-gear-effect-extension`,
  ),
  inputs = {},
  hash = (value) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes();
  inputs[path] = hash(bytes);
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const manifestBytes = await raw(`${root}/package.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  baseBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  base = JSON.parse(new TextDecoder().decode(baseBytes)),
  profile = await Bun.file(
    `${cache}/public/decoder-16.21-macos/profile.json`,
  ).json();
await raw(`${cache}/public/decoder-16.21-macos/profile.json`);
if (
  manifest.kind !== "prepared-gear-effect-extension" ||
  hash(baseBytes) !== manifest.baseManifestSha256 ||
  hash(await raw(`${cache}/public/latest-unit-gear-resources/package.json`)) !==
    manifest.unitGearResourcesSha256 ||
  hash(
    await raw(
      `${cache}/public/latest-positive-form-resource-prefix/package.json`,
    ),
  ) !== manifest.positivePrefixPackageSha256 ||
  manifest.scope.ordinaryActivationEnabled !== false ||
  manifest.scope.renderedCoverageEstablished !== false
)
  throw Error("Exact inactive extension source closure required");
for (const [file, metadata] of Object.entries(manifest.files)) {
  const path = resolve(root, file);
  if (!path.startsWith(root + sep)) throw Error("Extension file escaped root");
  const bytes = await raw(path);
  if (hash(bytes) !== metadata.sha256 || bytes.length !== metadata.bytes)
    throw Error(`Corrupt extension file ${file}`);
}
const packages = {};
for (const name of ["values", "birth", "emission", "samplers"])
  packages[name] = await raw(
    `${cache}/public/decoder-16.21-macos/vfx-${name}.json`,
  );
const kernels = await createDirectEffectKernels({ profile, packages }),
  definitions = [],
  reasons = {};
for (const [id, reference] of Object.entries(manifest.definitions)) {
  if (base.definitions[id] && base.definitions[id].sha256 !== reference.sha256)
    throw Error(`Extension/base canonical definition collision: ${id}`);
  if (reference.class !== "VfxSystemDefinitionData") continue;
  const compiled = await compileLatestDirectEffect({
    id,
    definitionBytes: await raw(`${root}/${reference.file}`),
    manifest,
    manifestBytes,
    kernels,
  });
  for (const emitter of compiled.unsupported)
    for (const reason of emitter.reasons)
      reasons[reason] = (reasons[reason] ?? 0) + 1;
  definitions.push({
    id,
    definitionSha256: reference.sha256,
    authoredComponents: reference.complexEmitters + reference.simpleEmitters,
    systemBlockers: compiled.blockers,
    compilerRetained: compiled.emitters.map((emitter) => ({
      index: emitter.index,
      name: emitter.source.emitterName,
      primitive: emitter.primitive,
      materialKey: emitter.materialKey,
      source: {
        isSingleParticle: emitter.source.isSingleParticle ?? false,
        rate: emitter.source.rate ?? null,
        lifetime: emitter.source.lifetime ?? null,
        particleLifetime: emitter.source.particleLifetime ?? null,
        bindWeight: emitter.source.bindWeight ?? null,
        particleIsLocalOrientation:
          emitter.source.particleIsLocalOrientation ?? null,
      },
      firstCountWithSuppliedClock: kernels.emission.count(emitter.source, {
        time: 0,
        normalizedAge: 0,
        lastEmissionTime: 0,
        qualityScale: 1,
        hasEmitted: false,
      }),
      emissionScope:
        "Shared count kernel at explicit time0/age0/quality1; parent activation and birth execution are separate gates",
      placementRequirements: emitter.placementRequirements,
      materialAdmission:
        "gear-extension:owned-native-material-observation-unprepared",
    })),
    omittedEmitters: compiled.unsupported,
  });
}
for (const [path, digest] of Object.entries(inputs))
  if (hash(await Bun.file(path).bytes()) !== digest)
    throw Error(`Extension inspector input changed: ${path}`);
const report = {
  schema: 1,
  kind: "inactive-gear-extension-compiler-frontier",
  inputs,
  extensionSha256: hash(manifestBytes),
  definitions,
  omittedReasonCounts: reasons,
  summary: {
    definitions: definitions.length,
    authoredComponents: definitions.reduce(
      (n, row) => n + row.authoredComponents,
      0,
    ),
    compilerRetained: definitions.reduce(
      (n, row) => n + row.compilerRetained.length,
      0,
    ),
    systemUnblockedCompilerRetained: definitions
      .filter((row) => row.systemBlockers.length === 0)
      .reduce((n, row) => n + row.compilerRetained.length, 0),
    nativeMaterialAdmitted: 0,
    placedInstances: 0,
    renderedInstances: 0,
  },
  scope: {
    staticCandidateInventoryOnly: true,
    noMaterialGuardWaived: true,
    ordinaryActivationEnabled: false,
    actualEquippedStateAccepted: null,
    renderedCoverageEstablished: false,
  },
};
await Bun.write(
  `${cache}/research/gear-effect-extension/compiled-frontier-v35.json`,
  stringifyAssetJson(report, 2),
);
console.log(JSON.stringify(report.summary));
