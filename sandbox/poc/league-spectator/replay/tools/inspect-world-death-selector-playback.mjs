import path from "node:path";
import { strict as assert } from "node:assert";
import { bindLatestMinions } from "../latest-world.mjs";
import { createLatestAnimationPoses } from "../latest-animation-poses.mjs";
import { createAnimationGraph } from "../latest-animation.mjs";
import { createLatestVfxValues } from "../latest-vfx-values.mjs";
import { createLatestVfxBirth } from "../latest-vfx-birth.mjs";
import {
  prepareLatestLifecycle,
  sampleLatestLifecycle,
  sampleLatestDeathPosePreview,
} from "../latest-lifecycle.mjs";
import { bindLatestDeathAnimationChoices } from "../latest-animation-selectors.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [sectionsPath, assetRoot, output] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun inspect-world-death-selector-playback.mjs <semantic-sections.json> <exact-asset-root> <output.json>",
  );
const inputs = {},
  raw = async (file) => {
    const bytes = await Bun.file(path.join(assetRoot, file)).bytes();
    inputs[file] = await sha256(bytes);
    return bytes;
  },
  read = async (file) => JSON.parse(new TextDecoder().decode(await raw(file))),
  sectionBytes = await Bun.file(sectionsPath).bytes(),
  sections = JSON.parse(new TextDecoder().decode(sectionBytes)),
  report = sections.sections,
  profile = await read("decoder-16.21-macos/profile.json"),
  scene = await read("latest-scene/manifest.json"),
  world = await read("latest-scene/world.json"),
  birth = createLatestVfxBirth(
    await read("decoder-16.21-macos/vfx-birth.json"),
    createLatestVfxValues(await read("decoder-16.21-macos/vfx-values.json")),
  ),
  poses = await createLatestAnimationPoses(
    profile,
    await raw("decoder-16.21-macos/animation-clock.json"),
    await raw("latest-animation-poses/manifest.json"),
  ),
  graphs = new Map();
assert.equal(
  inputs["decoder-16.21-macos/vfx-birth.json"],
  profile.vfxBirthSha256,
);
assert.equal(
  inputs["decoder-16.21-macos/vfx-values.json"],
  profile.vfxValuesSha256,
);
for (const [assetKey, asset] of Object.entries(world.assets)) {
  if (!asset.animationGraph) continue;
  const graphBytes = await raw(`latest-scene/${asset.animationGraph}`),
    catalogBytes = await raw(`latest-scene/${asset.animationCatalog}`),
    binding = await poses.bind(asset.animationGraph, graphBytes, catalogBytes);
  graphs.set(
    assetKey,
    createAnimationGraph(
      JSON.parse(new TextDecoder().decode(graphBytes)),
      binding.catalog,
      binding.clock,
    ),
  );
}
const entries = bindLatestMinions(report, scene, world).minions.map(
    (entry) => ({ ...entry, graph: graphs.get(entry.unit.asset) }),
  ),
  lifecycle = prepareLatestLifecycle(report),
  random = birth.createRandom(1n),
  owner = bindLatestDeathAnimationChoices(entries, lifecycle, random),
  initial = owner.diagnostics(),
  cases = [],
  snapshots = new Map();
for (const entry of entries) {
  if (entry.graph.find("Death")?.value.__type !== "SelectorClipData") continue;
  for (const interval of lifecycle.tracks.get(entry.event.entityId) ?? []) {
    if (interval.postDeathActions.length)
      throw Error(
        "Post-death selector actions require their native controller",
      );
    for (const age of [0, 0.001, 2, 3.999999]) {
      const time = interval.death.time + age;
      if (time > report.endTime) continue;
      const life = sampleLatestLifecycle(
          lifecycle.tracks.get(entry.event.entityId),
          time,
        ),
        choice = owner.forDeath(entry.graph, life),
        pose = sampleLatestDeathPosePreview(entry.graph, life, time, choice);
      assert.equal(pose.unresolved.length, 0);
      assert.equal(pose.leaves.length, 1);
      assert(pose.leaves[0].phase < pose.duration);
      const key = `${entry.event.entityId}:${time}`;
      snapshots.set(key, structuredClone(pose));
      cases.push({ entry, time, key });
    }
  }
}
for (const { entry, time, key } of cases.toReversed()) {
  const life = sampleLatestLifecycle(
    lifecycle.tracks.get(entry.event.entityId),
    time,
  );
  assert.deepEqual(
    sampleLatestDeathPosePreview(
      entry.graph,
      life,
      time,
      owner.forDeath(entry.graph, life),
    ),
    snapshots.get(key),
  );
}
assert.deepEqual(owner.diagnostics(), initial);
const offender = entries.find((entry) => entry.event.entityId === 1073919415),
  life = sampleLatestLifecycle(
    lifecycle.tracks.get(offender.event.entityId),
    2900,
  ),
  exactOffender = sampleLatestDeathPosePreview(
    offender.graph,
    life,
    2900,
    owner.forDeath(offender.graph, life),
  );
owner.close();
const sources = {};
for (const file of [
  "latest-animation.mjs",
  "latest-animation-selectors.mjs",
  "latest-lifecycle.mjs",
  "latest-vfx-birth.mjs",
  "latest-animation-clock.mjs",
  "latest-animation-poses.mjs",
  "tools/inspect-world-death-selector-playback.mjs",
])
  sources[file] = await sha256(
    await Bun.file(new URL(`../${file}`, import.meta.url)).bytes(),
  );
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-full-replay-death-selector-playback-control",
      sourceSha256: sections.sourceSha256,
      sectionsSha256: await sha256(sectionBytes),
      inputs,
      sources,
      selectorState: initial,
      forwardSamples: cases.length,
      backwardSamples: cases.length,
      exactOffender: {
        entityId: offender.event.entityId,
        time: 2900,
        death: life.interval.death,
        pose: exactOffender,
      },
      scope:
        "Actual whole-match recorded selector deaths, original weighted/RNG kernel with explicit seed1 control, exact clip clocks and stable backward sampling; rendered browser playback and native global RNG ordering remain separate",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    selectorState: initial,
    forwardSamples: cases.length,
    backwardSamples: cases.length,
    exactOffender: {
      entityId: offender.event.entityId,
      selected: exactOffender.leaves[0].name,
      phase: exactOffender.leaves[0].phase,
    },
  }),
);
