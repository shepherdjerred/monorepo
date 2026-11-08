import { resolve } from "node:path";
import { bindLatestBuildings, bindLatestMinions } from "../latest-world.mjs";
const [arg, reportArg] = process.argv.slice(2);
if (!arg) throw Error("Usage: sample-world-state.mjs <cache>");
const cache = resolve(arg),
  root = `${cache}/public/latest-scene`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  sceneBytes = await Bun.file(`${root}/manifest.json`).arrayBuffer(),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes)),
  worldBytes = await Bun.file(`${root}/${scene.world}`).arrayBuffer(),
  world = JSON.parse(new TextDecoder().decode(worldBytes)),
  reportPath = resolve(
    reportArg ?? `${cache}/research/latest-semantics-world-state.json`,
  ),
  reportBytes = await Bun.file(reportPath).arrayBuffer(),
  report = JSON.parse(new TextDecoder().decode(reportBytes)),
  entities = [
    ...bindLatestBuildings(report, scene, world).map((b) => ({
      entityId: b.event.entityId,
      entityClass: "turret",
      creationTime: b.event.time,
      asset: b.object.asset,
      characterRecords: [b.object.characterRecord],
      team: b.event.team,
    })),
    ...bindLatestMinions(report, scene, world).minions.map((b) => ({
      entityId: b.event.entityId,
      entityClass: "lane-minion",
      creationTime: b.event.time,
      asset: b.unit.asset,
      characterRecords: [
        ...new Set(b.unit.records.map((r) => r.characterRecord)),
      ],
      team: null,
    })),
  ];
const sources = {};
for (const p of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-world.mjs"),
])
  sources[p] = sha(await Bun.file(p).arrayBuffer());
await Bun.write(
  `${cache}/research/world-state-bindings.json`,
  JSON.stringify({
    schema: 1,
    build: report.build,
    protocol: report.protocol,
    sceneManifestSha256: sha(sceneBytes),
    worldCatalogSha256: sha(worldBytes),
    reportPath,
    reportSha256: sha(reportBytes),
    sources,
    entities,
  }),
);
console.log(JSON.stringify({ entities: entities.length }));
