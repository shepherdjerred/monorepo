import path from "node:path";
import { createSceneVfxMaterialBindings } from "../scene-vfx-material-bindings.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { sceneMaterialEnvironments } from "../scene-vfx-material-contract.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [
  nativeBuildArg,
  sceneArg,
  effectsArg,
  nativeArg,
  materialArg,
  outputArg,
] = process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun inspect-scene-vfx-material-bindings.mjs <approved-native-package> <scene-root> <effects-root> <native-authority> <material-authority> <output.json>",
  );
const roots = {
    native: path.resolve(nativeArg),
    material: path.resolve(materialArg),
  },
  nativeAuthorityBytes = await Bun.file(
    path.join(nativeArg, "manifest.json"),
  ).bytes(),
  materialAuthorityBytes = await Bun.file(
    path.join(materialArg, "manifest.json"),
  ).bytes(),
  native = JSON.parse(new TextDecoder().decode(nativeAuthorityBytes)),
  materials = JSON.parse(new TextDecoder().decode(materialAuthorityBytes)),
  consumed = new Map();
const bytes = {
  baseProfileBytes: await Bun.file(
    path.join(nativeBuildArg, "profile.json"),
  ).bytes(),
  imageBytes: await Bun.file(path.join(nativeBuildArg, "image.bin")).bytes(),
  sceneBytes: await Bun.file(path.join(sceneArg, "manifest.json")).bytes(),
  effectsManifestBytes: await Bun.file(
    path.join(effectsArg, "manifest.json"),
  ).bytes(),
  nativeAuthorityBytes,
  materialAuthorityBytes,
};
await captureDirectSourceInputs([import.meta.path], async (file) => {
  const raw = await Bun.file(file).bytes();
  consumed.set(file, sha(raw));
  return raw;
});
async function readResource({ authority, file }) {
  const root = roots[authority],
    source = path.resolve(root, file);
  if (!source.startsWith(root + path.sep))
    throw Error("Material control source escaped owned root");
  const raw = await Bun.file(source).bytes();
  consumed.set(source, sha(raw));
  return raw;
}
const api = await createSceneVfxMaterialBindings({ ...bytes, readResource });
let observed = 0,
  predicates = 0;
for (const row of materials.emitters) {
  await api.bindDefinitions([row.effectId]);
  if (row.status !== "original-material-selector-observed") continue;
  for (const environment of sceneMaterialEnvironments(row.definedObjectMask)) {
    const description = await api.describe(
      row.effectId,
      row.emitterIndex,
      environment,
      { erosionDrive: row.erosionParameters.length ? 0.5 : null },
    );
    if (description.graphSha256 !== row.graphSha256)
      throw Error("Actual material graph identity differs");
    predicates++;
  }
  observed++;
}
let negatives = 0;
for (const mutate of [
  (value) => {
    value.sceneManifestSha256 = "0".repeat(64);
  },
  (value) => {
    value.sources["vfx_material_native.py"] = "0".repeat(64);
  },
  (value) => {
    value.emitters[0].graphSha256 = "0".repeat(64);
  },
  (value) => {
    value.emitters[0].probes[0].input.resourceMask = 8;
  },
]) {
  const value = structuredClone(materials);
  mutate(value);
  try {
    await createSceneVfxMaterialBindings({
      ...bytes,
      materialAuthorityBytes: new TextEncoder().encode(JSON.stringify(value)),
      readResource,
    });
  } catch {
    negatives++;
    continue;
  }
  throw Error("Forged scene material authority was accepted");
}
const first = materials.emitters[0];
try {
  await api.describe(
    first.effectId,
    first.emitterIndex,
    {
      ...sceneMaterialEnvironments(first.definedObjectMask)[0],
      resourceMask: 8,
    },
    { erosionDrive: null },
  );
} catch {
  negatives++;
}
if (negatives !== 5) throw Error("Unknown material environment was accepted");
for (const [file, digest] of consumed)
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Material control source changed");
const result = {
  schema: 1,
  kind: "actual-scene-material-binding-control",
  authority: api.describeAuthority(),
  nativeAuthoritySha256: sha(nativeAuthorityBytes),
  materialAuthoritySha256: sha(materialAuthorityBytes),
  sourceEmitters: native.emitters.length,
  originalSelectorRows: observed,
  originalPredicateControls: predicates,
  negativeControls: negatives,
  resourceReads: consumed.size,
  inputs: Object.fromEntries(consumed),
  scope: {
    actualScenePredicates: false,
    resourceAcquisition: false,
    gpuSubmission: false,
    nativeRendererAdmitted: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
