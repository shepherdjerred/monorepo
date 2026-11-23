import path from "node:path";
import { bindLatestMinions } from "../latest-world.mjs";
import {
  prepareLatestLifecycle,
  sampleLatestLifecycle,
} from "../latest-lifecycle.mjs";
import { createLatestCorpsePolicy } from "../latest-corpse.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [sectionsPath, graphPath, assetRoot, timeArgument, output] =
    process.argv.slice(2),
  time = Number(timeArgument);
if (!output || !Number.isFinite(time))
  throw Error(
    "Usage: bun inspect-world-death-at-time.mjs <sections.json> <death-graphs.json> <asset-root> <time> <output.json>",
  );
const source = await Bun.file(sectionsPath).json(),
  report = source.sections,
  graphs = await Bun.file(graphPath).json(),
  raw = (file) => Bun.file(path.join(assetRoot, file)).bytes(),
  sceneBytes = await raw("latest-scene/manifest.json"),
  worldBytes = await raw("latest-scene/world.json"),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes)),
  world = JSON.parse(new TextDecoder().decode(worldBytes)),
  profile = await Bun.file(
    path.join(assetRoot, "decoder-16.21-macos/profile.json"),
  ).json(),
  policy = await createLatestCorpsePolicy(
    profile,
    sceneBytes,
    worldBytes,
    await raw("latest-corpse/package.json"),
  ),
  bindings = bindLatestMinions(report, scene, world),
  lifecycle = prepareLatestLifecycle(report),
  rows = [];
for (const binding of bindings.minions) {
  const life = sampleLatestLifecycle(
    lifecycle.tracks.get(binding.event.entityId),
    time,
  );
  if (!life.dead) continue;
  const duration = policy.bind(binding.unit.asset, [
      ...new Set(binding.unit.records.map((record) => record.characterRecord)),
    ]),
    ticks =
      Math.round(time * policy.metadata.clockFrequencyInput) -
      Math.round(
        life.interval.death.time * policy.metadata.clockFrequencyInput,
      ),
    retained = policy.retainsTicks(true, ticks, duration);
  if (!retained.retained) continue;
  const graph = graphs.results.find(
    (row) => row.graph === binding.asset.animationGraph,
  );
  rows.push({
    entityId: binding.event.entityId,
    assetKey: binding.unit.asset,
    graph: binding.asset.animationGraph,
    creation: binding.event,
    life,
    retained,
    graphStart: graph.start,
    recordedAnimations: report.animations.filter(
      (row) => row.entityId === binding.event.entityId,
    ),
    recordedCasts: report.casts.filter(
      (row) => row.entityId === binding.event.entityId,
    ),
  });
}
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      sourceSha256: source.sourceSha256,
      sectionsSha256: await sha256(await Bun.file(sectionsPath).bytes()),
      graphReportSha256: await sha256(await Bun.file(graphPath).bytes()),
      time,
      candidates: rows,
      scope:
        "Recorded dead minions retained by the original asset corpse-duration predicate; original per-packet mode admission remains in the main playback policy",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    candidates: rows.map((row) => ({
      entityId: row.entityId,
      asset: row.assetKey,
      death: row.life.interval.death.time,
      retained: row.retained,
      unresolved: row.graphStart.unresolved,
      animations: row.recordedAnimations.length,
    })),
  }),
);
