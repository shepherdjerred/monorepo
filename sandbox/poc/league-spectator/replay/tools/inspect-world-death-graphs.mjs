import path from "node:path";
import { createLatestAnimationPoses } from "../latest-animation-poses.mjs";
import { createAnimationGraph, animationHash } from "../latest-animation.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [assetRoot, output] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun inspect-world-death-graphs.mjs <exact-public-asset-root> <output.json>",
  );
const inputs = {},
  raw = async (relative) => {
    const bytes = await Bun.file(path.join(assetRoot, relative)).bytes();
    inputs[relative] = await sha256(bytes);
    return bytes;
  },
  read = async (relative) =>
    JSON.parse(new TextDecoder().decode(await raw(relative))),
  profile = await read("decoder-16.21-macos/profile.json"),
  world = await read("latest-scene/world.json"),
  poses = await createLatestAnimationPoses(
    profile,
    await raw("decoder-16.21-macos/animation-clock.json"),
    await raw("latest-animation-poses/manifest.json"),
  ),
  results = [];
for (const [assetKey, asset] of Object.entries(world.assets)) {
  if (!asset.animationGraph) continue;
  const graphBytes = await raw(`latest-scene/${asset.animationGraph}`),
    catalogBytes = await raw(`latest-scene/${asset.animationCatalog}`),
    binding = await poses.bind(asset.animationGraph, graphBytes, catalogBytes),
    source = JSON.parse(new TextDecoder().decode(graphBytes)),
    graph = createAnimationGraph(source, binding.catalog, binding.clock),
    definition = Object.values(source).find(
      (value) => value.__type === "AnimationGraphData",
    ),
    deathNode = Object.entries(definition.mClipDataMap).find(
      ([name]) =>
        animationHash(name) === animationHash("Death") ||
        name === animationHash("Death"),
    );
  results.push({
    assetKey,
    model: asset.model,
    graph: asset.animationGraph,
    start: graph.evaluate("Death", 0, { moving: false }),
    deathNode,
  });
}
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      inputs,
      sourceSha256: await sha256(await Bun.file(import.meta.path).bytes()),
      results,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    results: results.map(({ assetKey, start }) => ({
      assetKey,
      duration: start.duration,
      unresolved: start.unresolved,
    })),
  }),
);
