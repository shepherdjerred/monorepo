import { expect, test } from "bun:test";
import { createLatestDirectMissileFamilyAdapter } from "./latest-direct-missile-family-adapter.mjs";
import { createMissilePresentationFamilies } from "./latest-missile-presentation-context.mjs";
import { createProjectilePresentation } from "./latest-projectile-presentation.mjs";
import { createLatestWorldPresentation } from "./latest-world-presentation.mjs";
import { createLatestTerrain } from "./latest-terrain.mjs";
import {
  freezeDirectOwnedData,
  protectDirectDataGraph,
  isDirectImmutableData,
} from "./latest-direct-immutable-data.mjs";

const cache = new URL("../../../../.cache/replay-spike/", import.meta.url);
const load = (path) => Bun.file(new URL(`public/${path}`, cache)).bytes();
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await load(path)));
const { report } = await Bun.file(
  new URL("research/viewer-root-reconstruction.json", cache),
).json();
const profile = await read("decoder-16.21-macos/profile.json");
const scene = await read("latest-scene/manifest.json");
const manifest = await read("latest-effects/manifest.json");
const heights = await load("latest-scene/heights.bin");
const terrain = createLatestTerrain(
  scene,
  new Float32Array(heights.buffer, heights.byteOffset, heights.byteLength / 4),
);
const world = createLatestWorldPresentation({ report, scene, terrain });
// Recompute the strict families from decoded packets and static
// kernels. An offline motion trace is never supplied to the runtime adapter.
const presentation = await createMissilePresentationFamilies({
  profile,
  report,
  scene,
  terrain,
  world,
  load,
  endTime: report.endTime,
});
const adapter = createLatestDirectMissileFamilyAdapter({
  report,
  manifest,
  presentation,
});

test("strict fixed-speed and fixed-time families preserve distinct source ownership", () => {
  expect(presentation.traces).toHaveLength(65);
  expect(adapter.events).toHaveLength(130);
  expect(adapter.omitted).toEqual([]);
  expect(new Set(adapter.events.map((e) => e.id)).size).toBe(130);
  const creations = adapter.events.filter((e) => e.kind === "create");
  expect(new Set(creations.map((e) => e.definitionId))).toEqual(
    new Set([
      "champions/hecarim/0/140baed2",
      "champions/vladimir/39/3e190969",
      "champions/maokai/3/b9b1a66e",
      "champions/jinx/2/cbd1b40e",
    ]),
  );
  expect(
    creations.every(
      (e) =>
        e.origin === "missile" &&
        e.ownerId > 0 &&
        e.sourceEventId.startsWith("packet:"),
    ),
  ).toBe(true);
  expect(
    creations.every(
      (e) => e.resourceSelection.presentation.nativeAcceptance === null,
    ),
  ).toBe(true);
});

test("the three empty-reference packets retain decoded Jinx ownership and separate causal identities", () => {
  const creations = adapter.events.filter(
    (event) => event.kind === "create" && event.ownerId === 1073741894,
  );
  expect(creations.map((event) => event.sourceEventId)).toEqual([
    "packet:41292:entry:0:missile:1073744553",
    "packet:41347:entry:0:missile:1073744556",
    "packet:41402:entry:0:missile:1073744559",
  ]);
  expect(new Set(creations.map((event) => event.id)).size).toBe(3);
  for (const event of creations) {
    expect(event.definitionId).toBe("champions/jinx/2/cbd1b40e");
    expect(event.missilePresentation.requestedTargetEntityId).toBeNull();
    expect(event.missilePresentation.familyPolicy).toBe(
      "native-rofl-zero-reference-fixed-time-partial-v1",
    );
    expect(
      adapter.placement(event, event.time, {
        transportSequence: event.transportSequence,
        entryOrder: event.entryOrder,
        exclusive: true,
      }).resolved,
    ).toBe(false);
    expect(
      adapter.placement(event, event.time, {
        transportSequence: event.transportSequence,
        entryOrder: event.entryOrder,
      }).resolved,
    ).toBe(true);
  }
});

test("positions agree with the family query and only verified FixedTime traces supply their retained effect basis", () => {
  const projectiles = createProjectilePresentation(report, presentation);
  for (const event of adapter.events.filter((e) => e.kind === "create")) {
    const trace = presentation.traces.find(
      (t) => t.sequence === event.missilePresentation.sequence,
    );
    for (const time of [
      trace.startTime,
      (trace.startTime + trace.stopTime) / 2,
      trace.stopTime + 0.01,
    ]) {
      const pose = adapter.placement(event, time);
      expect(pose.position).toEqual(
        projectiles
          .query(event.entityId, Math.min(time, trace.stopTime))
          .position.map(Math.fround),
      );
      const sampled = projectiles.query(
        event.entityId,
        Math.min(time, trace.stopTime),
      );
      expect(pose.basis).toEqual(sampled.basis);
      if (trace.effectBasisProgram) {
        expect(pose.basis).toHaveLength(9);
        expect(event.missilePresentation.omissions).not.toContain(
          "world:missile-root-basis-unrecovered",
        );
        expect(event.resourceSelection.presentation.omissions).not.toContain(
          "world:missile-root-basis-unrecovered",
        );
        expect(pose.rootInput.effectBasisProgram.policy).toBe(
          trace.effectBasisProgram.policy,
        );
      } else {
        expect(pose.basis).toBeNull();
        expect(event.missilePresentation.omissions).toContain(
          "world:missile-root-basis-unrecovered",
        );
      }
      expect(pose.boundObjectSize).toBeUndefined();
      expect(pose.nativeAcceptance).toBeNull();
    }
    expect(adapter.placement(event, trace.startTime - 0.01).resolved).toBe(
      false,
    );
  }
});

test("FixedTime basis programs preserve stopped orientation and reject forged source/configuration/geometry", () => {
  const traces = presentation.traces.filter(
    (trace) => trace.effectBasisProgram,
  );
  expect(traces).toHaveLength(13);
  expect(traces.filter((trace) => trace.startTime >= 69)).toHaveLength(9);
  for (const trace of traces) {
    const stopped = trace.states.findIndex((state) => state.stopped);
    expect(stopped).toBeGreaterThan(0);
    expect(trace.states[stopped].effectBasis).toEqual(
      trace.states[stopped - 1].effectBasis,
    );
  }
  const selected = presentation.traces.indexOf(traces[0]);
  for (const mutate of [
    (trace) => {
      trace.effectBasisProgram.turnSpeed = 1;
    },
    (trace) => {
      trace.effectBasisProgram.spellHash += 1;
    },
    (trace) => {
      trace.effectBasisProgram.spellName += "-foreign";
    },
    (trace) => {
      trace.effectBasisProgram.extra = true;
    },
    (trace) => {
      trace.states[0].effectBasis[0] += 0.1;
    },
    (trace) => {
      trace.states[0].velocity = [0, 0, 0];
    },
    (trace) => {
      delete trace.effectBasisProgram;
    },
    (trace) => {
      trace.policy = "native-rofl-retained-target-fixed-speed-partial-v2";
    },
  ]) {
    const changed = structuredClone(presentation);
    mutate(changed.traces[selected]);
    expect(() => createProjectilePresentation(report, changed)).toThrow();
  }
});

test("foreign ownership and replay contracts fail, and source mutations cannot move retained particles", () => {
  const event = adapter.events.find((e) => e.kind === "create");
  for (const change of [
    { ownerId: event.ownerId + 1 },
    { definitionId: "different" },
    { sourceEventId: "different" },
  ])
    expect(() =>
      adapter.placement({ ...event, ...change }, event.time),
    ).toThrow("Owned direct missile family");
  expect(() =>
    createLatestDirectMissileFamilyAdapter({
      report: { ...report, replaySha256: "0".repeat(64) },
      manifest,
      presentation,
    }),
  ).toThrow();
  const changed = structuredClone(presentation);
  const isolated = createLatestDirectMissileFamilyAdapter({
    report,
    manifest,
    presentation: changed,
  });
  const before = isolated.placement(event, event.time);
  changed.traces[0].states[0].position[0] += 1000;
  expect(isolated.placement(event, event.time)).toEqual(before);
});

test("a family without a finite stop stays an explicit omission", () => {
  const changed = structuredClone(presentation);
  changed.traces[0].stopTime = null;
  const partial = createLatestDirectMissileFamilyAdapter({
    report,
    manifest,
    presentation: changed,
  });
  expect(partial.events).toHaveLength(128);
  expect(partial.omitted).toEqual([
    {
      sequence: changed.traces[0].sequence,
      entityId: changed.traces[0].entityId,
      sourceEventId: changed.traces[0].sourceEventId,
      reasons: ["direct-missile-family:finite-admitted-stop-boundary-required"],
    },
  ]);
});

test("same-time placement observes the exact creation entry cutoff and rejects malformed cursors", () => {
  for (const event of adapter.events.filter((e) => e.kind === "create")) {
    const cursor = {
      transportSequence: event.transportSequence,
      entryOrder: event.entryOrder,
    };
    expect(adapter.placement(event, event.time, cursor).resolved).toBe(true);
    expect(
      adapter.placement(event, event.time, { ...cursor, exclusive: true })
        .resolved,
    ).toBe(false);
    expect(
      adapter.placement(event, event.time, {
        transportSequence: event.transportSequence - 1,
        entryOrder: 0,
      }).resolved,
    ).toBe(false);
  }
  const event = adapter.events.find((e) => e.kind === "create");
  for (const cursor of [
    {},
    { transportSequence: -1, entryOrder: 0 },
    { transportSequence: event.transportSequence, entryOrder: 0.5 },
    { transportSequence: event.transportSequence, entryOrder: 0, exclusive: 1 },
  ])
    expect(() => adapter.placement(event, event.time, cursor)).toThrow(
      "Causal projectile",
    );
});

test("foreign duplicated source evidence and acceptance claims cannot alter an owned event", () => {
  const event = adapter.events.find((e) => e.kind === "create");
  for (const change of [
    { sourceEventId: "foreign-packet" },
    { nativeAcceptance: true },
  ]) {
    const changed = structuredClone(event);
    Object.assign(changed.missilePresentation, change);
    expect(() => adapter.placement(changed, event.time)).toThrow(
      "Owned direct missile family",
    );
  }
  for (const change of [
    { policy: "foreign-policy" },
    { nativeAcceptance: true },
    { definitionSha256: "0".repeat(64) },
  ]) {
    const changed = structuredClone(event);
    Object.assign(changed.resourceSelection.presentation, change);
    expect(() => adapter.placement(changed, event.time)).toThrow(
      "Owned direct missile family",
    );
  }
});

test("successful mutable and shallow-frozen events are revalidated after nested metadata changes", () => {
  const event = adapter.events.find((e) => e.kind === "create");
  for (const shallowFreeze of [false, true]) {
    for (const field of ["missilePresentation", "resourceSelection"]) {
      const changed = structuredClone(event);
      if (shallowFreeze) Object.freeze(changed);
      expect(adapter.placement(changed, event.time).resolved).toBe(true);
      if (field === "missilePresentation")
        changed.missilePresentation.sourceEventId = "foreign-after-success";
      else
        changed.resourceSelection.presentation.definitionSha256 = "0".repeat(
          64,
        );
      expect(() => adapter.placement(changed, event.time)).toThrow(
        "Owned direct missile family",
      );
    }
  }
});

test("all actual family creates can share immutable metadata with read-only stop inputs", () => {
  const events = structuredClone(adapter.events),
    protectedObjects = new WeakSet();
  for (const e of events)
    if (e.kind === "omitted") protectDirectDataGraph(e, protectedObjects);
  for (const e of events)
    if (e.kind === "create") freezeDirectOwnedData(e, protectedObjects);
  const creations = events.filter((e) => e.kind === "create");
  expect(creations).toHaveLength(65);
  for (const created of creations) {
    const stopped = events.find(
      (e) =>
        e.kind === "stop" &&
        e.missilePresentation === created.missilePresentation,
    );
    expect(stopped).toBeDefined();
    expect(isDirectImmutableData(created)).toBe(true);
    expect(adapter.placement(created, created.time)).toEqual(
      adapter.placement(created, created.time),
    );
    expect(adapter.placement(created, stopped.time).resolved).toBe(true);
  }
});
