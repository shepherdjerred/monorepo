import path from "node:path";
import { animationHash } from "../latest-animation.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [sceneRoot, outputFile] = process.argv.slice(2);
if (!sceneRoot || !outputFile || process.argv.length !== 4)
  throw Error(
    "Usage: bun inspect-scene-animation-provider-needs.mjs <scene-root> <output.json>",
  );
const inputs = {};
async function raw(file) {
  file = path.resolve(file);
  const bytes = await Bun.file(file).bytes(),
    hash = await sha256(bytes);
  if (inputs[file] && inputs[file] !== hash)
    throw Error("Animation provider inventory source changed");
  inputs[file] = hash;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const manifest = decode(await raw(path.join(sceneRoot, "manifest.json"))),
  inventory = new Map(manifest.files.map((ref) => [ref.path, ref]));
async function resource(file) {
  if (typeof file !== "string" || !inventory.has(file))
    throw Error("Inventoried original animation graph required");
  const bytes = await raw(path.join(sceneRoot, file)),
    ref = inventory.get(file);
  if (bytes.length !== ref.bytes || (await sha256(bytes)) !== ref.sha256)
    throw Error("Animation graph source identity differs");
  return bytes;
}
const world = decode(await resource(manifest.world));
const providerClasses = new Map(),
  actors = [];
for (const [actor, asset] of Object.entries({
  ...manifest.champions,
  ...world.assets,
})) {
  const graphBytes = await resource(asset.animationGraph),
    graph = decode(graphBytes);
  const roots = Object.values(graph).filter(
    (value) => value.__type === "AnimationGraphData",
  );
  if (roots.length !== 1)
    throw Error("One original animation graph root required");
  const clips = new Map(
    Object.entries(roots[0].mClipDataMap).map(([name, node]) => [
      name.startsWith("{") ? name.toLowerCase() : animationHash(name),
      { name, node },
    ]),
  );
  function providers(value, trail = "", found = []) {
    if (!value || typeof value !== "object") return found;
    if (value.__type && /Updater|Driver/.test(value.__type)) {
      found.push({
        trail,
        type: value.__type,
        configuration: structuredClone(value),
      });
    }
    for (const [key, child] of Object.entries(value))
      if (child && typeof child === "object")
        providers(child, trail + "/" + key, found);
    return found;
  }
  const all = [];
  for (const [hash, { name, node }] of clips)
    for (const provider of providers(node))
      all.push({ clip: name, hash, ...provider });
  for (const row of all)
    providerClasses.set(row.type, (providerClasses.get(row.type) ?? 0) + 1);
  const canonical = {};
  for (const name of ["Idle1", "Run"]) {
    const pending = [name],
      seen = new Set(),
      nodes = [],
      requirements = [];
    while (pending.length) {
      const requested = pending.pop(),
        hash = requested.startsWith("{")
          ? requested.toLowerCase()
          : animationHash(requested);
      if (seen.has(hash)) continue;
      seen.add(hash);
      const item = clips.get(hash);
      if (!item) {
        nodes.push({ hash, status: "missing-original-node" });
        continue;
      }
      const { node } = item;
      nodes.push({ hash, type: node.__type });
      for (const provider of providers(node))
        requirements.push({ clip: item.name, ...provider });
      pending.push(
        ...(node.mClipNameList ?? []),
        ...[node.mTrueConditionClipName, node.mFalseConditionClipName].filter(
          Boolean,
        ),
        ...[
          "mParametricPairDataList",
          "mSelectorPairDataList",
          "mConditionFloatPairDataList",
        ].flatMap((field) => (node[field] ?? []).map((row) => row.mClipName)),
      );
    }
    canonical[name] = {
      nodes,
      providers: requirements,
      reachableChildPolicy: "explicit-known-original-clip-link-fields",
    };
  }
  actors.push({
    actor,
    graph: asset.animationGraph,
    graphSha256: await sha256(graphBytes),
    canonical,
    allProviders: all,
  });
}
for (const [file, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(file).bytes())) !== hash)
    throw Error(
      "Animation provider inventory source changed before publication",
    );
await Bun.write(
  path.resolve(outputFile),
  JSON.stringify(
    {
      schema: 1,
      kind: "original-scene-animation-provider-requirements",
      build: manifest.build,
      protocol: manifest.protocol,
      inputs,
      actors,
      providerClasses: Object.fromEntries([...providerClasses].sort()),
      scope: {
        sourceBoundStaticRequirementsOnly: true,
        unknownChildLinkSemanticsRemainExplicit: true,
        decodedReplayProviderState: false,
        nativeDynamicGraphAdmitted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    actors: actors.length,
    providerClasses: Object.fromEntries([...providerClasses].sort()),
  }),
);
