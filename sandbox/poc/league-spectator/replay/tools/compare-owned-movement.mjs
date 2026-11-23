import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { captureResearchSourceClosure } from "./research-source-closure.mjs";

const [reportPath, assetRoot, output] = process.argv.slice(2);
if (!output) throw Error("Usage: compare-owned-movement.mjs <whole-semantic-report.json> <approved-public-root> <output.json>");
const roots = [new URL(import.meta.url)], before = await captureResearchSourceClosure(roots);
await Bun.write(output + ".source-start.json", JSON.stringify(before,null,2));
const [{prepareLatestMovement},{createOwnedLatestMovement,bindOwnedLatestMovement},{sampleMovement},{createLatestWorldPresentation},{createLatestTerrain}] = await Promise.all([
  import("../latest-movement.mjs"),import("../latest-owned-movement.mjs"),import("../playback.mjs"),
  import("../latest-world-presentation.mjs"),import("../latest-terrain.mjs"),
]);
const hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const reportHasher = new Bun.CryptoHasher("sha256");
for await (const bytes of Bun.file(reportPath).stream()) reportHasher.update(bytes);
const report = await Bun.file(reportPath).json();
const sceneBytes = await Bun.file(resolve(assetRoot,"latest-scene/manifest.json")).bytes();
const heightBytes = await Bun.file(resolve(assetRoot,"latest-scene/heights.bin")).bytes();
const scene = JSON.parse(new TextDecoder().decode(sceneBytes));
const terrain = createLatestTerrain(scene,new Float32Array(heightBytes.buffer,heightBytes.byteOffset,heightBytes.byteLength/4));
const prepared = prepareLatestMovement(report,scene.map), owner = createOwnedLatestMovement(report,scene.map);
const view = bindOwnedLatestMovement(owner,report,scene.map);
if (!isDeepStrictEqual(prepared.summary,view.summary)) throw Error("Accepted movement summary differs");
const world = createLatestWorldPresentation({report,scene,terrain});
const shared = createLatestWorldPresentation({report,scene,terrain,movementOwner:owner});
let samples = 0, worldQueries = 0;
const digest = new Bun.CryptoHasher("sha256");
function projection(sample) {
  if (!sample) return null;
  const event = sample.event;
  return { point:sample.point, direction:sample.direction, moving:sample.moving,
    event:{ entityId:event.entityId,time:event.time,sequence:event.sequence,
      transportSequence:event.transportSequence,entryOrder:event.entryOrder,speed:event.speed,source:event.source } };
}
for (const [id,rows] of prepared.tracks) {
  for (const row of rows) for (const time of [row.time, row.time + 1/60, Math.max(0,row.time - 1/60)]) {
    const baseline = projection(sampleMovement(rows,time)), candidate = projection(view.sample(id,time));
    if (!isDeepStrictEqual(baseline,candidate)) throw Error(`Owned movement differs: ${id}/${time}`);
    digest.update(JSON.stringify(candidate)); samples++;
  }
}
for (let index = report.movement.length - 1; index >= 0; index--) {
  const row = report.movement[index];
  const cursors = [null];
  if (Number.isSafeInteger(row.transportSequence)) for (const exclusive of [false,true])
    cursors.push({transportSequence:row.transportSequence,entryOrder:row.entryOrder ?? 0,exclusive});
  for (const cursor of cursors) {
    const baseline = world.entity(row.entityId,row.time,cursor), candidate = shared.entity(row.entityId,row.time,cursor);
    if (!isDeepStrictEqual(baseline,candidate)) throw Error(`Owned movement world differs: ${row.entityId}/${row.time}/${JSON.stringify(cursor)}`);
    digest.update(JSON.stringify(candidate)); worldQueries++;
  }
}
const after = await captureResearchSourceClosure(roots);
if (!isDeepStrictEqual(before,after)) throw Error("Owned movement comparison source changed during execution");
const result = {scope:"Whole retained replay accepted-path samples and world-position/provenance comparison; no native motion or performance parity claim",
  reportSha256:reportHasher.digest("hex"),sceneSha256:hash(sceneBytes),heightsSha256:hash(heightBytes),
  movementRecords:report.movement.length,summary:view.summary,samples,worldQueries,mismatches:0,
  digest:digest.digest("hex"),implementationBefore:before,implementationAfter:after,sourceDrift:[]};
await Bun.write(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({output,samples,worldQueries,mismatches:0,sourceFiles:Object.keys(before).length}));
