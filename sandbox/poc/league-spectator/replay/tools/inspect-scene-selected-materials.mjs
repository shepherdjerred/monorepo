// Actual owned static-root/material factory control, separate from native GPU
// coverage. An empty prepared set must stay empty through the frame bridge.
import path from "node:path";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import {
  loadLatestSelectedMaterialRegistry,
  assertLatestSelectedMaterials,
} from "../latest-selected-materials.mjs";
import { createParentRenderFrames } from "../latest-parent-render-frame.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
const [rootArg, outputArg] = process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun inspect-scene-selected-materials.mjs <closed-selected-public-root> <output.json>",
  );
const root = path.resolve(rootArg),
  inputs = {};
async function raw(file) {
  const bytes = await Bun.file(file).bytes();
  inputs[path.resolve(file)] = sha(bytes);
  return bytes;
}
const load = (file) => raw(path.join(root, file));
await captureDirectSourceInputs([import.meta.path], raw);
const selection = await loadLatestStaticCatalogSelection({ load }),
  registry = await loadLatestSelectedMaterialRegistry({
    staticCatalog: selection,
    load,
  });
const catalog = selection.describe(),
  effectsBytes = await selection.readRole("effects"),
  effects = JSON.parse(new TextDecoder().decode(effectsBytes));
await registry.bindDefinitions(Object.keys(effects.definitions));
await registry.assertPackages({
  effectsManifestBytes: effectsBytes,
  quadPackageBytes: registry.packageBytes("quad"),
  trailPackageBytes: undefined,
  erosionPackageBytes: undefined,
});
const frames = await createParentRenderFrames({
  effectsManifestBytes: effectsBytes,
  quadPackageBytes: registry.packageBytes("quad"),
  trailPackageBytes: undefined,
  erosionPackageBytes: undefined,
  selectedMaterials: registry,
});
const compiled = await loadLatestDirectEffectPackage({
  load,
  manifestBytes: effectsBytes,
  effectIds: Object.keys(effects.definitions),
  staticCatalog: selection,
});
let rejected = 0;
try {
  assertLatestSelectedMaterials({ ...registry });
} catch {
  rejected++;
}
try {
  await loadLatestSelectedMaterialRegistry({
    staticCatalog: { ...selection },
    load,
  });
} catch {
  rejected++;
}
const foreign = await loadLatestStaticCatalogSelection({ load });
try {
  registry.assertSelection(foreign);
} catch {
  rejected++;
}
if (rejected !== 3)
  throw Error("Unowned/foreign scene material selection was accepted");
for (const attack of [
  {
    role: "sceneVfxNativeAuthority",
    mutate(bytes) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      value.sceneManifestSha256 = "0".repeat(64);
      return new TextEncoder().encode(JSON.stringify(value));
    },
  },
  {
    role: "shaderPairs",
    mutate() {
      throw Error("Missing required selected shader-pair resource");
    },
  },
]) {
  let failed = false;
  try {
    await loadLatestSelectedMaterialRegistry({
      staticCatalog: selection,
      load: async (file) =>
        file === catalog.roles[attack.role]
          ? attack.mutate(await load(file))
          : load(file),
    });
  } catch {
    failed = true;
  }
  if (!failed)
    throw Error("Wrong-parent/missing scene material resource was accepted");
  rejected++;
}
for (const [file, digest] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Selected material factory source changed during control");
const result = {
  schema: 1,
  kind: "actual-owned-scene-material-factory-control",
  selection: catalog,
  materials: registry.describe(),
  materialOwners: registry.materials().size,
  frameBridgeConstructed: !!frames,
  negativeControls: rejected,
  compiled: {
    definitions: compiled.definitions.size,
    preparedMaterials: compiled.materials.size,
    sourceEmitters: [...compiled.definitions.values()].reduce(
      (count, definition) =>
        count + definition.emitters.length + definition.unsupported.length,
      0,
    ),
    admittedEmitters: [...compiled.definitions.values()].reduce(
      (count, definition) => count + definition.emitters.length,
      0,
    ),
    unsupported: [...compiled.definitions.values()].reduce(
      (count, definition) => count + definition.unsupported.length,
      0,
    ),
  },
  inputs,
  scope: {
    actualScenePredicates: false,
    defaultTextureSubstitutions: false,
    gpuSubmitted: false,
    nativeRendererAdmitted: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result));
console.log(
  JSON.stringify({
    output: outputArg,
    materials: result.materials,
    materialOwners: result.materialOwners,
    frameBridgeConstructed: result.frameBridgeConstructed,
    negativeControls: rejected,
    inputHashes: Object.keys(inputs).length,
    nativeRendererAdmitted: false,
  }),
);
