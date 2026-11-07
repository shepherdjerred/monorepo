import { expect, test } from "bun:test";
import { loadLatestDirectMissilePresentation } from "./latest-direct-missile-presentation.mjs";
import {
  createLatestWorldPresentation,
  buildLatestDirectEffectEvents,
} from "./latest-world-presentation.mjs";
import { createLatestTerrain } from "./latest-terrain.mjs";
import { createMissilePresentationFamilies } from "./latest-missile-presentation-context.mjs";
import { DIRECT_MISSILE_FAMILY_POLICY } from "./latest-direct-missile-family-adapter.mjs";
import { sampleLatestMissileTrace } from "./latest-missile-playback.mjs";

const base = new URL("../../../../.cache/replay-spike/", import.meta.url);
const load = (path) => Bun.file(new URL(`public/${path}`, base)).bytes();
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await load(path)));
const { report } = await Bun.file(
  new URL("research/viewer-root-reconstruction.json", base),
).json();
const profile = await read("decoder-16.21-macos/profile.json"),
  scene = await read("latest-scene/manifest.json"),
  manifest = await read("latest-effects/manifest.json"),
  h = await load("latest-scene/heights.bin");
const terrain = createLatestTerrain(
  scene,
  new Float32Array(h.buffer, h.byteOffset, h.byteLength / 4),
);
const presentation = await loadLatestDirectMissilePresentation({
  profile,
  report,
  scene,
  terrain,
  manifest,
  load,
});
const world = createLatestWorldPresentation({
  report,
  scene,
  terrain,
  effectsManifest: manifest,
  directMissilePresentation: presentation,
});
const families = await createMissilePresentationFamilies({
  profile,
  report,
  scene,
  terrain,
  load,
  world: createLatestWorldPresentation({ report, scene, terrain }),
  endTime: report.endTime,
});
const combinedWorld = (changes = {}) =>
  createLatestWorldPresentation({
    report,
    scene,
    terrain,
    effectsManifest: manifest,
    directMissilePresentation: presentation,
    targetedMissilePresentation: families,
    ...changes,
  });

// A supplied network fixture retains its own complete request ledger even when
// it intentionally shares a projectile packet's time and entity identity.
const suppliedNetworkReport = (record) => ({
  ...report,
  effectCreations: [
    {
      opcode: 756,
      entityId: record.entityId,
      creationSequence: record.sequence,
      time: record.time,
      transportSequence: record.transportSequence,
      stream: record.stream,
      chunkId: record.chunkId,
      blockOffset: record.blockOffset,
      contextId: record.contextId,
      resourceContextEntityId: 0,
      lookupA8EntityId: 0,
      lookup14EntityId: 0,
      attachmentEntityId: 0,
    },
  ],
  effectRemovals: [],
});

test("the world routes only owned direct missile events and retains the source packet lifecycle", () => {
  const events = world.directMissileEvents(),
    event = events.find((event) => event.kind === "create");
  expect(events.filter((event) => event.kind === "create")).toHaveLength(30);
  expect(world.placement(event, event.time).resolved).toBe(true);
  expect(world.placement(event, event.time).nativeAcceptance).toBeNull();
  expect(() =>
    world.placement({ ...event, id: "foreign" }, event.time),
  ).toThrow("Owned");
  expect(() =>
    world.placement(
      {
        ...event,
        missilePresentation: {
          ...event.missilePresentation,
          policy: "foreign",
        },
      },
      event.time,
    ),
  ).toThrow("explicit owned");
  events[0].id = "caller-mutated";
  expect(world.directMissileEvents()[0].id).not.toBe("caller-mutated");
});

test("actual direct mode merges independent families and routes verified effect bases with their owned events", () => {
  const direct = combinedWorld(),
    events = direct.directMissileEvents();
  expect(events.filter((e) => e.kind === "create")).toHaveLength(95);
  expect(events.filter((e) => e.kind === "stop")).toHaveLength(95);
  expect(world.directMissileFamilyDiagnostics()).toBeNull();
  expect(
    createLatestWorldPresentation({
      report,
      scene,
      terrain,
      effectsManifest: manifest,
      targetedMissilePresentation: families,
    }).directMissileEvents(),
  ).toEqual([]);
  const event = events.find(
    (e) =>
      e.kind === "create" &&
      e.missilePresentation.policy === DIRECT_MISSILE_FAMILY_POLICY,
  );
  const pose = direct.placement(event, event.time);
  expect(pose.resolved).toBe(true);
  for (const creation of events.filter(
    (e) =>
      e.kind === "create" &&
      e.missilePresentation.policy === DIRECT_MISSILE_FAMILY_POLICY,
  )) {
    const trace = families.traces.find(
      (row) => row.sequence === creation.missilePresentation.sequence,
    );
    for (const time of [
      trace.startTime,
      (trace.startTime + trace.stopTime) / 2,
      trace.stopTime,
    ]) {
      const actual = direct.placement(creation, time);
      const expected = trace.effectBasisProgram
        ? sampleLatestMissileTrace(trace, time).effectBasis
        : null;
      expect(actual.basis).toEqual(expected);
      if (expected)
        expect(
          actual.basis.every((lane, index) => Object.is(lane, expected[index])),
        ).toBe(true);
      else
        expect(actual.basisStatus).toBe(
          "native-missile-root-basis-unrecovered",
        );
    }
  }
  expect(pose.boundObjectSize).toBeUndefined();
  expect(pose.nativeAcceptance).toBeNull();
  expect(
    direct.placement(event, event.time, {
      transportSequence: event.transportSequence,
      entryOrder: event.entryOrder,
      exclusive: true,
    }).resolved,
  ).toBe(false);
  expect(() => world.placement(event, event.time)).toThrow(
    "explicit owned policy",
  );
  const diagnostic = direct.directMissileFamilyDiagnostics();
  expect(diagnostic.creates).toBe(65);
  expect(diagnostic.omitted).toEqual([]);
  expect(diagnostic.nativeAcceptance).toBeNull();
  diagnostic.creates = 0;
  expect(direct.directMissileFamilyDiagnostics().creates).toBe(65);
  event.id = "mutated";
  expect(direct.directMissileEvents().some((e) => e.id === "mutated")).toBe(
    false,
  );
});

test("legacy/family entity overlap rejects different source packets before runtime activation", () => {
  const changedReport = structuredClone(report),
    changedLegacy = structuredClone(presentation);
  const legacy = changedLegacy.traces[0],
    family = families.traces[0];
  expect(legacy.entityId).not.toBe(family.entityId);
  const record = changedReport.missiles.find(
    (r) => r.sequence === legacy.sequence,
  );
  expect(record.transportSequence).not.toBe(
    changedReport.missiles.find((r) => r.sequence === family.sequence)
      .transportSequence,
  );
  record.entityId = family.entityId;
  legacy.entityId = family.entityId;
  expect(() =>
    combinedWorld({
      report: changedReport,
      directMissilePresentation: changedLegacy,
    }),
  ).toThrow("ownership overlaps");
});

test("family omissions and generated cast diagnostics survive the combined lifecycle", () => {
  const changed = structuredClone(families),
    trace = changed.traces[0];
  trace.stopTime = null;
  const direct = combinedWorld({ targetedMissilePresentation: changed });
  expect(direct.directMissileFamilyDiagnostics().omitted).toEqual([
    expect.objectContaining({
      sequence: trace.sequence,
      reasons: ["direct-missile-family:finite-admitted-stop-boundary-required"],
    }),
  ]);
  const events = buildLatestDirectEffectEvents({
    report,
    world: direct,
    targetedMissilePresentation: changed,
    pipeline: { events: [] },
    unitResources: {
      metadata: { build: report.build, protocol: report.protocol },
    },
  });
  const omitted = events.find(
    (e) => e.id === `missile:${trace.entityId}:${trace.sequence}`,
  );
  expect(omitted.kind).toBe("omitted");
  expect(omitted.reasons).toContain(
    "direct-missile-family:finite-admitted-stop-boundary-required",
  );
  expect(events.filter((e) => e.origin === "missile-behavior")).toHaveLength(
    65,
  );
  expect(
    events
      .filter((e) => e.origin === "missile-behavior")
      .every((e) => e.kind === "omitted"),
  ).toBe(true);
  const unprepared = structuredClone(manifest);
  const effect = direct
    .directMissileEvents()
    .find(
      (e) =>
        e.kind === "create" &&
        e.missilePresentation.policy === DIRECT_MISSILE_FAMILY_POLICY,
    ).definitionId;
  for (const actor of Object.values(unprepared.actors))
    for (const binding of Object.values(actor.missiles))
      if (binding.effectId === effect) binding.status = "unprepared";
  const unbound = combinedWorld({ effectsManifest: unprepared });
  expect(
    unbound
      .directMissileFamilyDiagnostics()
      .omitted.some((e) => e.reasons.some((r) => r.startsWith("resource:"))),
  ).toBe(true);
});

test("family ownership never deduplicates a separate network creation", () => {
  const direct = combinedWorld(),
    own = direct
      .directMissileEvents()
      .find(
        (e) =>
          e.kind === "create" &&
          e.missilePresentation.policy === DIRECT_MISSILE_FAMILY_POLICY,
      );
  const record = report.missiles.find(
    (r) => r.sequence === own.missilePresentation.sequence,
  );
  const events = buildLatestDirectEffectEvents({
    report: suppliedNetworkReport(record),
    world: direct,
    targetedMissilePresentation: families,
    unitResources: {
      metadata: { build: report.build, protocol: report.protocol },
      selectSuppliedStacks: () => ({
        status: "supplied-test-resource",
        resource: { status: "prepared-definition", effectId: own.definitionId },
      }),
    },
    pipeline: {
      events: [
        {
          kind: "create-request",
          entityId: own.entityId,
          creationSequence: record.sequence,
          time: own.time,
          transportSequence: record.transportSequence,
          entryOrder: record.sequence,
        },
      ],
      creation: () => ({
        descriptor: {
          field8c: 0,
          resourceContextEntityId: 0,
          lookupA8EntityId: 0,
          lookup14EntityId: 0,
          attachmentEntityId: 0,
          resourceKey: 1,
          unresolvedAuxiliaryContextIds: [],
        },
      }),
    },
  });
  expect(events.filter((e) => e.kind === "create")).toHaveLength(96);
  expect(events.find((e) => e.id === own.id).sourceEventId).toBe(
    own.sourceEventId,
  );
  const network = events.find(
    (e) => e.id === `network-effect:${own.entityId}:${record.sequence}`,
  );
  expect(network.origin).toBe("network-effect");
  expect(network.definitionId).toBe(own.definitionId);
  expect(network.ownerId).toBeNull();
  expect(events.filter((e) => e.kind === "stop")).toHaveLength(95);
});

test("the event builder replaces only its owned baseline missile row and preserves network identities", () => {
  const own = world
    .directMissileEvents()
    .find((event) => event.kind === "create");
  const record = report.missiles.find(
    (record) => record.sequence === own.missilePresentation.sequence,
  );
  // An explicitly supplied network request shares entity/time/definition with
  // the missile. Those coincidences do not establish cross-origin ownership.
  const network = {
    kind: "create-request",
    entityId: record.entityId,
    creationSequence: record.sequence,
    time: record.time,
    transportSequence: record.transportSequence,
    entryOrder: record.sequence,
  };
  const events = buildLatestDirectEffectEvents({
    report: suppliedNetworkReport(record),
    world,
    unitResources: {
      metadata: { build: report.build, protocol: report.protocol },
      selectSuppliedStacks: () => ({
        status: "supplied-test-resource",
        resource: { status: "prepared-definition", effectId: own.definitionId },
      }),
    },
    pipeline: {
      events: [network],
      creation: () => ({
        descriptor: {
          field8c: 0,
          resourceContextEntityId: 0,
          lookupA8EntityId: 0,
          lookup14EntityId: 0,
          attachmentEntityId: 0,
          resourceKey: 1,
          unresolvedAuxiliaryContextIds: [],
        },
      }),
    },
  });
  expect(events.filter((event) => event.id === own.id)).toHaveLength(1);
  expect(
    events.some(
      (event) => event.id === `missile:${record.entityId}:${record.sequence}`,
    ),
  ).toBe(false);
  expect(events.filter((event) => event.kind === "create")).toHaveLength(31);
  expect(events.filter((event) => event.kind === "stop")).toHaveLength(30);
  const networkRow = events.find(
    (event) =>
      event.id === `network-effect:${record.entityId}:${record.sequence}`,
  );
  expect(networkRow.origin).toBe("network-effect");
  expect(networkRow.entityId).toBe(own.entityId);
  expect(networkRow.definitionId).toBe(own.definitionId);
  expect(networkRow.time).toBe(own.time);
  expect(networkRow.ownerId).toBeNull();
  expect(networkRow.ownershipStatus).toBe("network-creator-unresolved");
  const unowned = report.missiles.find(
    (record) =>
      !presentation.traces.some((trace) => trace.sequence === record.sequence),
  );
  expect(
    events.some(
      (event) => event.id === `missile:${unowned.entityId}:${unowned.sequence}`,
    ),
  ).toBe(true);
  expect(events.find((event) => event.id === own.id).sourceEventId).toBe(
    own.sourceEventId,
  );
});
