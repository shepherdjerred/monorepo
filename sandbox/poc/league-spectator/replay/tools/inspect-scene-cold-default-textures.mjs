import path from "node:path";
import { createSceneColdDefaultTextures } from "../scene-cold-default-textures.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
const [rootArg, reportArg] = process.argv.slice(2);
if (!reportArg)
  throw Error(
    "Usage: bun inspect-scene-cold-default-textures.mjs <cold-default-package-root> <output.json>",
  );
const root = path.resolve(rootArg),
  inputs = {};
async function raw(file) {
  const bytes = await Bun.file(file).bytes();
  inputs[path.resolve(file)] = sha(bytes);
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const manifestBytes = await raw(path.join(root, "manifest.json")),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  proofs = {};
for (const ref of manifest.files)
  proofs[ref.file] = await raw(path.join(root, ref.file));
const api = await createSceneColdDefaultTextures({
    manifestBytes,
    readResource: async (file) => proofs[file],
  }),
  bindings = [
    api.binding({
      semantic: "absent-base",
      authoredPath: "",
      samplerDescriptorHex: "0000000101",
    }),
    api.binding({
      semantic: "absent-mult",
      authoredPath: null,
      samplerDescriptorHex: "0101010101",
    }),
    api.binding({ semantic: "shared-remap" }),
  ];
if (api.describe().emptyAuthoredColorBindingProved)
  bindings.push(
    api.binding({
      semantic: "absent-color",
      authoredPath: "",
      samplerDescriptorHex: "0101010101",
    }),
  );
const negatives = [];
if (api.describe().emptyAuthoredColorBindingProved) {
  for (const [kind, request] of [
    [
      "named-color-texture",
      {
        semantic: "absent-color",
        authoredPath: "authored-color.tex",
        samplerDescriptorHex: "0101010101",
      },
    ],
    [
      "wrong-color-sampler",
      {
        semantic: "absent-color",
        authoredPath: "",
        samplerDescriptorHex: "0000000101",
      },
    ],
  ]) {
    let rejected = false;
    try {
      api.binding(request);
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error("Unproved color default accepted");
    negatives.push(kind);
  }
}
for (const [kind, run] of [
  [
    "named-authored-resource",
    () =>
      api.binding({
        semantic: "absent-base",
        authoredPath: "missing-authored.tex",
        samplerDescriptorHex: "0000000101",
      }),
  ],
  [
    "unproved-color-semantic",
    () => api.binding({ semantic: "particle-color" }),
  ],
  [
    "unknown-sampler",
    () =>
      api.binding({
        semantic: "absent-mult",
        samplerDescriptorHex: "0303030101",
      }),
  ],
  [
    "missing-proof",
    () =>
      createSceneColdDefaultTextures({
        manifestBytes,
        readResource: async () => new Uint8Array(),
      }),
  ],
]) {
  let rejected = false;
  try {
    await run();
  } catch {
    rejected = true;
  }
  if (!rejected) throw Error("Unproved original default accepted: " + kind);
  negatives.push(kind);
}
const forged = structuredClone(manifest);
forged.evidence.resources["shared-remap"].rgba = [255, 0, 0, 255];
let rejected = false;
try {
  await createSceneColdDefaultTextures({
    manifestBytes: new TextEncoder().encode(JSON.stringify(forged)),
    readResource: async (file) => proofs[file],
  });
} catch {
  rejected = true;
}
if (!rejected) throw Error("Forged native default projection accepted");
negatives.push("forged-projection");
for (const [file, digest] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Original cold-default factory input changed");
const report = {
  schema: 1,
  kind: "original-cold-default-factory-control",
  authority: api.describe(),
  bindings,
  negativeControls: negatives,
  inputs,
  scope: {
    genuineColdResourcesOnly: true,
    actualEmitterColorDefaultProved: false,
    actualScenePredicates: false,
    dynamicRemapRecovered: false,
    particleDrawSubmitted: false,
    nativeRendererAdmitted: false,
  },
};
await Bun.write(reportArg, JSON.stringify(report));
console.log(
  JSON.stringify({
    output: reportArg,
    bindings: bindings.length,
    negativeControls: negatives.length,
    inputHashes: Object.keys(inputs).length,
    nativeRendererAdmitted: false,
  }),
);
