import { expect, test } from "bun:test";
import {
  compileSuppliedNontrackingFixedSpeedSpec,
  createSuppliedNontrackingFixedSpeedController,
  planUnadmittedNontrackingFixedSpeedFamily,
} from "./latest-nontracking-fixed-speed.mjs";
import { createLatestTerrain } from "./latest-terrain.mjs";
import { createTriggerOnHitNoHitActors } from "./latest-trigger-on-hit.mjs";
import { createPresentationMissileActors } from "./latest-presentation-missile-actors.mjs";
import { createLatestMissileActors } from "./latest-missile-actors.mjs";
import { indexLatestMissileEvents } from "./latest-missiles.mjs";
const cache = new URL("../../../../.cache/replay-spike/", import.meta.url),
  read = (path) => Bun.file(new URL(path, cache)).json();
const motionDefinition = await read(
    "public/decoder-16.21-macos/missile-motion.json",
  ),
  controllerDefinition = await read(
    "public/decoder-16.21-macos/missile-controllers.json",
  ),
  catalog = await read("public/latest-scene/champions/akshan/20/spells.json"),
  source = catalog.spells["43261541"].data.mMissileSpec,
  compile = (spec) =>
    compileSuppliedNontrackingFixedSpeedSpec(
      spec,
      motionDefinition,
      controllerDefinition,
    );
test("inactive nontracking spec keeps the observed source/header/height/facing bounds", () => {
  expect(compile(source).resolved).toBe(true);
  for (const patch of [
    { mTracksTarget: true },
    { mUseHeightOffsetAtEnd: true },
    { mUseGroundHeightAtTarget: true },
    { mInferDirectionFromFacingIfNeeded: true },
    { mStartDelay: 1 },
    { mStartBoneName: "" },
    { mTargetBoneName: "target" },
    { mSpeed: 0 },
    { unknown: 0 },
  ])
    expect(
      compile({
        ...source,
        movementComponent: { ...source.movementComponent, ...patch },
      }).resolved,
    ).toBe(false);
  expect(
    compile({
      ...source,
      heightSolver: { __type: "FollowTerrainHeightSolver", mHeightOffset: 1 },
    }).resolved,
  ).toBe(false);
  expect(
    compile({
      ...source,
      verticalFacing: { __type: "VeritcalFacingMatchVelocity" },
    }).resolved,
  ).toBe(false);
});
test("supplied-input controller preserves constructor velocity, requires explicit clocks and isolates its endpoint", async () => {
  const native = await read(
      "research/nontracking-fixed-speed-frames-native-v35.json",
    ),
    row = native.cases[0],
    manifest = await read("public/latest-scene/manifest.json"),
    heights = await Bun.file(
      new URL("public/latest-scene/heights.bin", cache),
    ).arrayBuffer(),
    terrain = createLatestTerrain(manifest, new Float32Array(heights)),
    controller = createSuppliedNontrackingFixedSpeedController({
      motionDefinition,
      controllerDefinition,
      terrain,
    });
  const b = Buffer.from(row.suppliedOriginalEndpoint.positionHex, "hex"),
    endpoint = {
      position: [b.readFloatLE(0), b.readFloatLE(4), b.readFloatLE(8)],
    },
    control = controller.initialize({
      record: row.record,
      start: { ...row.start, status: "initialized" },
      suppliedEndpoint: endpoint,
      spec: compile(source),
    });
  expect(control.ordinaryAdmission).toBe(false);
  expect(control.actualConsumedRangeRecovered).toBe(false);
  expect(control.state.velocity).toEqual(control.constructorVelocity);
  expect(control.state.velocity.some((v) => v !== 0)).toBe(true);
  endpoint.position[0]++;
  expect(control.state.targetPosition[0]).not.toBe(endpoint.position[0]);
  const before = structuredClone(control);
  expect(() =>
    controller.step(control, row.frames[0].time, row.frames[0].delta),
  ).toThrow("global frame delta");
  expect(control).toEqual(before);
  control.state.targetPosition[0]++;
  expect(() =>
    controller.step(control, row.frames[0].time, row.frames[0].delta, 1 / 60),
  ).toThrow("endpoint changed");
});
test("inactive planner preserves all actual causal identities and refuses numeric-endpoint metadata as admission", async () => {
  const inputs = await read("research/named-bone-caster-inputs-v35.json"),
    report = (await read("research/viewer-root-reconstruction.json")).report,
    actors = createTriggerOnHitNoHitActors(
      createPresentationMissileActors(
        createLatestMissileActors(
          await read("public/decoder-16.21-macos/missile-actors.json"),
        ),
      ),
    ),
    records = inputs.cases.map((row) => ({
      ...row.record,
      nontrackingSpec: compile(source),
      startInitialization: inputs.providerResults.find(
        (v) => v.sequence === row.sequence,
      ).start,
      targetInitialization: {
        status: "initialized",
        actualConsumedRangeRecovered: true,
        position: [1, 2, 3],
      },
    })),
    result = planUnadmittedNontrackingFixedSpeedFamily({
      records,
      eventIndex: indexLatestMissileEvents(report),
      actors,
      endTime: 99,
      build: report.build,
      protocol: report.protocol,
    });
  expect(result.traces).toHaveLength(0);
  expect(result.ordinaryAdmission).toBe(false);
  expect(result.omitted.map((row) => row.sequence)).toEqual([
    2843, 3676, 4141, 4313,
  ]);
  for (const row of result.omitted) {
    const record = records.find((r) => r.sequence === row.sequence);
    expect(row.reasons).toContain(
      "target:actual-consumed-caster-range-unrecovered",
    );
    expect(row.sourceRecord).toEqual(record);
    expect(row.payloadSha256).toBe(record.payloadSha256);
    expect(row.sourceEventId).toBe(
      `packet:${record.transportSequence}:entry:${record.entryOrder ?? 0}:missile:${record.entityId}`,
    );
    expect(row.notifications).toEqual(
      report.missileEvents
        .filter(
          (event) => event.entityId === record.entityId && event.time <= 99,
        )
        .sort(
          (a, b) =>
            a.time - b.time ||
            a.transportSequence - b.transportSequence ||
            (a.entryOrder ?? 0) - (b.entryOrder ?? 0),
        ),
    );
  }
  expect(
    result.omitted.filter((row) =>
      row.reasons.some((reason) => reason.startsWith("pose:")),
    ),
  ).toHaveLength(2);
});
