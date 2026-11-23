import { expect, test } from "bun:test";
import { createOwnedLatestMovement, bindOwnedLatestMovement } from "./latest-owned-movement.mjs";
import { prepareLatestMovement } from "./latest-movement.mjs";
import { sampleMovement } from "./playback.mjs";
import { createLatestWorldPresentation } from "./latest-world-presentation.mjs";

const map = { min: [0,0,0], max: [10,1,10], movementOrigin: [5,5] };
const fixture = () => ({
  build: "16.21.829.8620", protocol: "20e09df23c66b85e", replaySha256: "a".repeat(64),
  heroes: [{ entityId: 1, champion: "Test", team: 100, skinId: 0,
    creationPosition: [1,2,3], provenance: { time: 0, transportSequence: 5 } }],
  movement: [
    { entityId: 1, time: 1, sequence: 1, transportSequence: 10, entryOrder: 0,
      syncId: 1, speed: 4, encodedWaypoints: [[0,0],[4,0]] },
    { entityId: 1, time: 1, sequence: 2, transportSequence: 10, entryOrder: 1,
      syncId: 2, speed: 2, encodedWaypoints: [[0,0],[0,4]] },
    { entityId: 1, time: 2, sequence: 3, transportSequence: 11, entryOrder: 0,
      syncId: 1, speed: 2, encodedWaypoints: [[0,0],[4,4]] },
    { entityId: 2, time: 3, sequence: 4, transportSequence: 12, entryOrder: 0,
      syncId: 4, speed: 10, motion: { speed: 3 }, encodedWaypoints: [[1,1],[2,3],[4,5]] },
  ], lifecycle: [], worldEvents: [], casts: [], attacks: [], missiles: [],
});
const project = (value) => value === null ? null : ({
  point: value.point, direction: value.direction, moving: value.moving,
  time: value.event.time, sequence: value.event.sequence,
});
test("one owned index preserves initial, accepted sync, motion and absolute-time samples", () => {
  const report = fixture(), prepared = prepareLatestMovement(report, map);
  const view = bindOwnedLatestMovement(createOwnedLatestMovement(report, map), report, map);
  expect(view.summary).toEqual(prepared.summary);
  expect(view.summary.rejected).toBe(1);
  for (const id of [1,2,3]) for (const time of [-1,0,.5,1,1.5,2,3,3.25,20])
    expect(project(view.sample(id,time))).toEqual(project(sampleMovement(prepared.tracks.get(id),time)));
});
test("owned movement isolates caller, result and display copies and per-world creation ordinals", () => {
  const report = fixture(), owner = createOwnedLatestMovement(report,map);
  const renderer = bindOwnedLatestMovement(owner,report,map);
  const world = bindOwnedLatestMovement(owner,report,map,{heroCreationOrdinals:true});
  expect(renderer.sample(1,0).event.transportSequence).toBeUndefined();
  expect(world.sample(1,0,{transportSequence:5,entryOrder:0})).not.toBeNull();
  expect(world.sample(1,0,{transportSequence:5,entryOrder:0,exclusive:true})).toBeNull();
  expect(() => renderer.sample(1,0,{transportSequence:5,entryOrder:0})).toThrow("original packet ordinals");
  const before = world.sample(1,1.5);
  report.movement[1].encodedWaypoints[1][1] = 999;
  report.movement[1].speed = 999;
  report.heroes[0].provenance.transportSequence = 999;
  const result = world.sample(1,1.5); result.point[0] = 999; result.event.sequence = 999;
  const copies = world.copyHeroTracks([1]); copies.get(1)[2].waypoints[1][1] = 999;
  expect(world.sample(1,1.5)).toEqual(before);
  expect(world.sample(1,0).event.transportSequence).toBe(5);
  expect(world.sample(1,1,{transportSequence:10,entryOrder:1,exclusive:true}).event.sequence).toBe(1);
  expect(world.sample(1,1,{transportSequence:10,entryOrder:1}).event.sequence).toBe(2);
  expect(() => bindOwnedLatestMovement({},report,map)).toThrow("Matching owned movement");
  expect(() => bindOwnedLatestMovement(owner,{...report},map)).toThrow("Matching owned movement");
  expect(() => bindOwnedLatestMovement(owner,report,{...map,movementOrigin:[6,5]})).toThrow("Matching owned movement");
  report.replaySha256 = "b".repeat(64);
  expect(() => bindOwnedLatestMovement(owner,report,map)).toThrow("Matching owned movement");
});
test("shared renderer/world index preserves world roots and ordered provenance in both directions", () => {
  const report = fixture(), scene = { build: report.build, protocol: report.protocol, map };
  const terrain = { sampleHeight: () => ({inside:true,height:4}) };
  const baseline = createLatestWorldPresentation({report,scene,terrain});
  const candidate = createLatestWorldPresentation({report,scene,terrain,movementOwner:createOwnedLatestMovement(report,map)});
  const queries = [
    [0,null], [.5,null], [1,null], [1,{transportSequence:10,entryOrder:1,exclusive:true}],
    [1,{transportSequence:10,entryOrder:1}], [1.5,null], [20,null], [1,null], [0,null],
  ];
  for (const [time,cursor] of queries) {
    expect(candidate.entity(1,time,cursor)).toEqual(baseline.entity(1,time,cursor));
    expect(candidate.viewerRoot(1,time,cursor)).toEqual(baseline.viewerRoot(1,time,cursor));
  }
});
