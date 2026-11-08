import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { loadLatestDirectNavGroundMaterials } from "../latest-direct-nav-ground-materials.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    hash = await sha256(b);
  if (inputs[path] && inputs[path] !== hash) throw Error(`Input drift:${path}`);
  inputs[path] = hash;
  return b;
};
const load = (path) => raw(`${cache}/public/${path}`),
  manifestBytes = await load("latest-effects/manifest.json"),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
await captureDirectSourceInputs(
  [
    import.meta.path,
    resolve(import.meta.dir, "../latest-direct-effect-package.mjs"),
  ],
  raw,
);
const effectIds = [
    "champions/karthus/10/8ad0cea5",
    "champions/hecarim/0/e57b8289",
  ],
  prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes,
    effectIds,
  });
const selected = [...prepared.definitions.values()].flatMap((d) =>
  // Preserve the original four arbitrary-quad controls. The camera extension
  // and the combined five-component inventory have their own V37 control.
  d.emitters
    .filter((e) => e.navGroundProgram && e.primitive === "arbitrary-quad")
    .map((e) => ({ d, e })),
);
assert.equal(selected.length, 4);
assert(
  prepared.packages.compilationInputs.some(
    ([path, bytes]) =>
      path === "latest-direct-nav-ground-materials/package.json" &&
      bytes instanceof Uint8Array,
  ),
);
const compilationInputBytes = prepared.packages.compilationInputs.reduce(
  (n, [, bytes]) => n + bytes.byteLength,
  0,
);
let rejected = 0;
const reject = (fn) => {
  assert.throws(fn);
  rejected++;
};
for (const { d, e } of selected) {
  assert.equal(prepared.navGroundMaterials.admit(e), true);
  for (const mutate of [
    (e) => (e.source.texture = "forged.tex"),
    (e) => (e.source.blendMode = 0),
    (e) => (e.source.alphaRef = 0.9),
    (e) => (e.blend = 0),
    (e) => (e.source.texAddressModeBase = 2),
    (e) => (e.source.primitive = { __type: "VfxPrimitiveCameraQuad" }),
    (e) => (e.navGroundProgram.sourceDefinitionSha256 = "a".repeat(64)),
    (e) => (e.navGroundProgram.passHash = 0),
    (e) => (e.navGroundProgram.shaderPair.pixel = "b".repeat(64)),
    (e) =>
      (e.navGroundProgram = Object.assign(Object.create(e.navGroundProgram), {
        schema: 1,
      })),
    (e) =>
      (e.navGroundProgram = {
        ...e.navGroundProgram,
        toJSON() {
          return {};
        },
      }),
  ]) {
    const forged = structuredClone(e);
    mutate(forged);
    reject(() => prepared.navGroundMaterials.admit(forged));
  }
  const source = structuredClone(e.source);
  source.texture = "forged.tex";
  reject(() =>
    prepared.navGroundMaterials.compile({
      id: d.id,
      index: e.index,
      definitionHash: d.definitionHash,
      source,
      multUvProgram: e.multUvProgram,
    }),
  );
  reject(() =>
    prepared.navGroundMaterials.compile({
      id: d.id,
      index: e.index,
      definitionHash: "a".repeat(64),
      source: e.source,
      multUvProgram: e.multUvProgram,
    }),
  );
  if (e.multUvProgram) {
    const forged = structuredClone(e);
    forged.multUvProgram.rotation = 1;
    reject(() => prepared.navGroundMaterials.admit(forged));
  }
}
const records = await Promise.all(
  effectIds.map(async (id) => {
    const bytes = await load(`latest-effects/${manifest.definitions[id].file}`);
    return { ...JSON.parse(new TextDecoder().decode(bytes)), id, bytes };
  }),
);
for (const mutation of [
  (records) => (records[0].bytes[0] ^= 1),
  (records) =>
    (records[0].definition.complexEmitterDefinitionData[4].blendMode = 0),
]) {
  const forged = structuredClone(records);
  mutation(forged);
  await assert.rejects(() =>
    loadLatestDirectNavGroundMaterials({
      load,
      profile: prepared.profile,
      manifestBytes,
      records: forged,
    }),
  );
  rejected++;
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash, path);
const output = `${cache}/research/direct-nav-ground-material-control.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "owned-navigation-ground-source-material-controls",
      inputs,
      counts: {
        components: selected.length,
        negativeControls: rejected,
        compilationInputs: prepared.packages.compilationInputs.length,
        compilationInputBytes,
      },
      components: selected.map(({ d, e }) => ({
        definitionId: d.id,
        emitterId: e.index,
        definitionHash: d.definitionHash,
        program: e.navGroundProgram,
        omissions: e.omissions,
      })),
      scope: {
        normalPackageAndCompiler: true,
        completeHashOwnedSourceRequired: true,
        staticNativeResourcesOwned: true,
        gpuSubmitted: false,
        browserAcceptance: null,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    components: selected.length,
    rejected,
    compilationInputBytes,
  }),
);
