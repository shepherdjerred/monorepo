import { expect, test } from "bun:test";
import {
  loadLatestDirectMissilePresentation,
  buildLatestDirectMissilePresentation,
  createLatestDirectMissileAdapter,
  DIRECT_MISSILE_PRESENTATION_POLICY,
} from "./latest-direct-missile-presentation.mjs";
import { createLatestTerrain } from "./latest-terrain.mjs";
import { parentMissilePlacement } from "./latest-parent-missile-inputs.mjs";
import { loadLatestDirectEffectPackage } from "./latest-direct-effect-package.mjs";
import { LatestDirectEffectRuntime } from "./latest-direct-effect-runtime.mjs";
import { directGeometryBuffers } from "./latest-direct-effect-draw.mjs";
import {
  analyzeLatestMissiles,
  createLatestMissileMotion,
} from "./latest-missiles.mjs";
import { createLatestMissileControllers } from "./latest-missile-controllers.mjs";
import { createLatestMissileInitialization } from "./latest-missile-initialization.mjs";
import { createLatestMissileFrame } from "./latest-missile-frame.mjs";
import { createLatestMissileActors } from "./latest-missile-actors.mjs";

const cache = new URL("../../../../.cache/replay-spike/", import.meta.url);
const load = (path) => Bun.file(new URL(`public/${path}`, cache)).bytes();
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await load(path)));
const report = (
  await Bun.file(
    new URL("research/viewer-root-reconstruction.json", cache),
  ).json()
).report;
const profile = await read("decoder-16.21-macos/profile.json"),
  scene = await read("latest-scene/manifest.json"),
  manifest = await read("latest-effects/manifest.json"),
  heights = await load("latest-scene/heights.bin");
const terrain = createLatestTerrain(
  scene,
  new Float32Array(heights.buffer, heights.byteOffset, heights.byteLength / 4),
);
const presentation = await loadLatestDirectMissilePresentation({
  profile,
  report,
  scene,
  terrain,
  manifest,
  load,
});
const adapter = createLatestDirectMissileAdapter({
  report,
  manifest,
  presentation,
});

test("actual strict legacy motion yields separately owned direct presentation without claiming the old particle clock", () => {
  expect(presentation.traces).toHaveLength(30);
  expect(new Set(presentation.traces.map((trace) => trace.effectId))).toEqual(
    new Set(["champions/vladimir/39/9fbafd14"]),
  );
  expect(adapter.events).toHaveLength(60);
  expect(new Set(adapter.events.map((event) => event.id)).size).toBe(60);
  expect(presentation.exactLegacyParticleTimelineAgreement).toBe(false);
  const event = adapter.events.find((event) => event.kind === "create"),
    trace = presentation.traces.find(
      (trace) => trace.sequence === event.missilePresentation.sequence,
    );
  for (const time of [
    trace.startTime,
    (trace.startTime + trace.stopTime) / 2,
    trace.stopTime + 0.2,
  ]) {
    const pose = adapter.placement(event, time),
      expected = parentMissilePlacement(trace, time);
    expect(pose.position).toEqual(expected.position);
    expect(pose.basis).toEqual(
      expected.basis.filter((_, index) => index < 12 && index % 4 !== 3),
    );
    expect(pose.nativeAcceptance).toBeNull();
  }
  expect(event.sourceEventId).toMatch(/^packet:\d+:entry:\d+:missile:\d+$/);
  expect(event.resourceSelection.presentation.omissions).toContain(
    "ownership:network-effect-duplicate-relation-unrecovered",
  );
  expect(adapter.placement(event, trace.startTime - 0.01).resolved).toBe(false);
});

test("the adapter cannot waive an existing target-reference motion omission", async () => {
  const motionDefinition = await read(
      "decoder-16.21-macos/missile-motion.json",
    ),
    controllerDefinition = await read(
      "decoder-16.21-macos/missile-controllers.json",
    );
  const motion = createLatestMissileMotion(motionDefinition),
    controllers = createLatestMissileControllers(controllerDefinition),
    frame = createLatestMissileFrame(
      controllerDefinition,
      motion,
      controllers,
      terrain,
    ),
    actors = createLatestMissileActors(
      await read("decoder-16.21-macos/missile-actors.json"),
    );
  const subjects = await Promise.all(
    report.heroes.map(async (hero) => ({
      entityId: hero.entityId,
      character: hero.champion,
      catalog: await read(
        `latest-scene/${scene.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`].spellCatalog}`,
      ),
    })),
  );
  const analysis = analyzeLatestMissiles(report, subjects, motionDefinition, {
    manifest: scene,
    terrain,
    controllers,
    initialization: createLatestMissileInitialization(controllerDefinition),
    frame,
    actors,
  });
  const selected = analysis.records.find(
    (row) => row.sequence === presentation.traces[0].sequence,
  );
  selected.cast = { ...selected.cast, targetCount: 1 };
  const result = buildLatestDirectMissilePresentation({
    report,
    analysis,
    manifest,
    frame,
    actors,
    endTime: report.endTime,
  });
  expect(result.traces).toHaveLength(29);
  expect(
    result.omitted.find((row) => row.sequence === selected.sequence).reasons,
  ).toContain("target-reference-list");
});

test("worker projection rejects foreign source ownership and isolates retained poses from callers", () => {
  for (const mutate of [
    (p) => (p.replaySha256 = "0".repeat(64)),
    (p) => p.traces[0].ownerId++,
    (p) => (p.traces[0].effect.definitionSha256 = "0".repeat(64)),
    (p) => (p.traces[0].states[0].position[0] = NaN),
  ]) {
    const changed = structuredClone(presentation);
    mutate(changed);
    expect(() =>
      createLatestDirectMissileAdapter({
        report,
        manifest,
        presentation: changed,
      }),
    ).toThrow();
  }
  const input = structuredClone(presentation),
    inputReport = structuredClone(report),
    owned = createLatestDirectMissileAdapter({
      report: inputReport,
      manifest,
      presentation: input,
    });
  const event = owned.events[0],
    before = owned.placement(event, event.time);
  input.traces[0].states[0].position[0] = 999;
  input.endTime = event.time;
  inputReport.missiles.find(
    (row) => row.sequence === event.missilePresentation.sequence,
  ).time = 999;
  before.position[0] = 888;
  expect(owned.placement(event, event.time)).toEqual(
    adapter.placement(adapter.events[0], adapter.events[0].time),
  );
  expect(() =>
    owned.placement({ ...event, ownerId: event.ownerId + 1 }, event.time),
  ).toThrow("Owned");
});

test("one actual missile drives all ten trail, Legacy-offset and multiply-texture components through camera and repeated seeks", async () => {
  const trace = presentation.traces[0],
    single = { ...presentation, traces: [trace] },
    owned = createLatestDirectMissileAdapter({
      report,
      manifest,
      presentation: single,
    });
  const prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes: await load("latest-effects/manifest.json"),
    effectIds: [trace.effectId],
  });
  expect(
    prepared.definitions.get(trace.effectId).emitters.map((row) => row.index),
  ).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 9, 10]);
  const runtime = new LatestDirectEffectRuntime({
    ...prepared.contract,
    replayHash: report.replaySha256,
    definitions: prepared.definitions,
    kernels: prepared.kernels,
    events: owned.events,
    world: { placement: (event, time) => owned.placement(event, time) },
  });
  const time = trace.startTime + 0.1,
    camera = { right: [1, 0, 0], up: [0, 1, 0], axis: [0, 0, 1] };
  runtime.advanceTo(time);
  const checkpoint = runtime.checkpoint(),
    packet = runtime.generateDraws(camera);
  expect(packet.draws).toHaveLength(10);
  expect(
    packet.draws
      .filter((draw) => draw.primitive === "camera-trail")
      .map((draw) => draw.emitterId),
  ).toEqual([0, 1, 9]);
  expect(
    packet.draws
      .filter((draw) => draw.primitive === undefined)
      .map((draw) => draw.emitterId),
  ).toEqual([2, 3, 4, 5, 6, 8, 10]);
  expect(
    packet.draws.filter((draw) => draw.multUV).map((draw) => draw.emitterId),
  ).toEqual([2, 4, 5, 8]);
  const geometry = packet.draws.map((draw) => directGeometryBuffers(draw));
  for (const draw of packet.draws) {
    const packed = directGeometryBuffers(draw);
    expect(packed.vertices.byteLength).toBeGreaterThan(0);
    expect(packed.indices.byteLength).toBeGreaterThan(0);
    if (draw.multUV) {
      expect(draw.multUV).toBeInstanceOf(Uint16Array);
      expect(draw.multUV.byteLength).toBe(16);
      const view = new DataView(packed.vertices.buffer);
      for (let vertex = 0; vertex < draw.particleCount * 4; vertex++)
        for (let lane = 0; lane < 2; lane++)
          expect(view.getUint16(vertex * 28 + 24 + lane * 2, true)).toBe(
            draw.multUV[(vertex % 4) * 2 + lane],
          );
    }
  }
  expect(packet.draws.every((draw) => draw.indices.length > 0)).toBe(true);
  runtime.generateDraws({ ...camera, right: [0, 0, 1], axis: [1, 0, 0] });
  expect(runtime.checkpoint()).toEqual(checkpoint);
  for (let repeat = 0; repeat < 2; repeat++) {
    runtime.advanceTo(trace.startTime - 0.01);
    expect(runtime.generateDraws(camera).draws).toHaveLength(0);
    runtime.advanceTo(time);
    expect(runtime.checkpoint()).toEqual(checkpoint);
    const repeated = runtime.generateDraws(camera).draws;
    expect(repeated).toEqual(packet.draws);
    expect(repeated.map((draw) => directGeometryBuffers(draw))).toEqual(
      geometry,
    );
  }
  expect(
    packet.draws.every(
      (draw) =>
        draw.sourceEventId === owned.events[0].id &&
        draw.ownerId === trace.ownerId,
    ),
  ).toBe(true);
  expect(owned.policy).toBe(DIRECT_MISSILE_PRESENTATION_POLICY);
});
