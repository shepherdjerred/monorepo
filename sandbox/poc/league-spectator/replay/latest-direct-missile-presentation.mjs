import { buildLatestMissilePlayback } from "./latest-missile-playback.mjs";
import { bindLatestMissileEffects } from "./latest-effects.mjs";
import { parentMissilePlacement } from "./latest-parent-missile-inputs.mjs";
import {
  analyzeLatestMissiles,
  createLatestMissileMotion,
} from "./latest-missiles.mjs";
import { createLatestMissileControllers } from "./latest-missile-controllers.mjs";
import { createLatestMissileInitialization } from "./latest-missile-initialization.mjs";
import { createLatestMissileFrame } from "./latest-missile-frame.mjs";
import { createLatestMissileActors } from "./latest-missile-actors.mjs";
import { sha256 } from "./structural-comparison.mjs";

export const DIRECT_MISSILE_PRESENTATION_POLICY =
  "legacy-admitted-missile-direct-global-clock-partial-v1";
const build = "16.21.829.8620",
  protocol = "20e09df23c66b85e";
const ordinal = (value) => Number.isSafeInteger(value) && value >= 0;
const identity = (value) =>
  Number.isInteger(value) && value > 0 && value <= 0xffffffff;
const vector = (value, count) =>
  Array.isArray(value) &&
  value.length === count &&
  value.every((n) => Number.isFinite(n) && Number.isFinite(Math.fround(n)));
const sourceId = (record) =>
  `packet:${record.transportSequence}:entry:${record.entryOrder ?? 0}:missile:${record.entityId}`;
const instanceId = (record) =>
  `direct-missile:${record.entityId}:${record.transportSequence}:${record.entryOrder ?? 0}`;
const order = (a, b) =>
  a.time - b.time ||
  a.transportSequence - b.transportSequence ||
  a.entryOrder - b.entryOrder;
const omissions = Object.freeze([
  "policy:legacy-motion-admission-with-new-direct-particle-clock",
  "clock:absolute-60hz-grid-not-legacy-parent-birth-relative-grid",
  "seed:zero-per-emitter-presentation-policy-not-original-parent-rng-order",
  "placement:local-Y-flight-local-Z-up-supplied-preview-basis",
  "lifecycle:stop-applies-after-direct-boundary-update",
  "lifecycle:particle-linger-and-original-parent-retirement-unimplemented",
  "resource:static-spell-missile-binding-not-live-overlay-selection",
  "ownership:network-effect-duplicate-relation-unrecovered",
]);

// The unchanged legacy builder owns motion admission. This adapter never
// removes a reason returned by its frame/actor eligibility checks.
export function buildLatestDirectMissilePresentation({
  report,
  analysis,
  manifest,
  frame,
  actors,
  endTime,
}) {
  const bindings = bindLatestMissileEffects(report, manifest);
  if (
    report.build !== build ||
    report.protocol !== protocol ||
    !/^[a-f0-9]{64}$/.test(report.replaySha256) ||
    analysis.build !== build ||
    analysis.protocol !== protocol ||
    !Number.isFinite(endTime) ||
    endTime <= 0 ||
    !Number.isFinite(report.endTime) ||
    report.endTime <= 0 ||
    endTime > report.endTime
  )
    throw Error("Exact bounded direct missile presentation inputs required");
  const playback = buildLatestMissilePlayback(
    analysis,
    bindings,
    frame,
    actors,
    endTime,
  );
  const traces = [],
    omitted = structuredClone(playback.omitted);
  for (const trace of playback.traces) {
    if (trace.startTime > endTime) continue;
    if (
      !Number.isFinite(trace.stopTime) ||
      trace.stopTime < trace.startTime ||
      trace.stopTime > endTime
    ) {
      omitted.push({
        sequence: trace.sequence,
        entityId: trace.entityId,
        reasons: ["direct-missile:finite-admitted-stop-boundary-required"],
      });
      continue;
    }
    if (
      trace.states.some(
        (state) =>
          !vector(state.direction, 3) || !(Math.hypot(...state.direction) > 0),
      )
    ) {
      omitted.push({
        sequence: trace.sequence,
        entityId: trace.entityId,
        reasons: ["direct-missile:flight-basis-unresolved"],
      });
      continue;
    }
    traces.push(structuredClone(trace));
  }
  return {
    schema: 1,
    kind: "direct-missile-presentation",
    policy: DIRECT_MISSILE_PRESENTATION_POLICY,
    build,
    protocol,
    replaySha256: report.replaySha256,
    endTime,
    traces,
    omitted,
    legacyMotionEligibilityUnchanged: true,
    exactLegacyParticleTimelineAgreement: false,
    nativeAcceptance: null,
    rendered: false,
    complete: null,
    omissions: [...omissions],
  };
}

// Serializable worker output is matched back to its original source packet
// and static binding. It cannot replace a network instance or infer a dedup.
export function createLatestDirectMissileAdapter({
  report,
  manifest,
  presentation,
}) {
  if (
    presentation?.schema !== 1 ||
    presentation.kind !== "direct-missile-presentation" ||
    presentation.policy !== DIRECT_MISSILE_PRESENTATION_POLICY ||
    report.build !== build ||
    report.protocol !== protocol ||
    presentation.build !== build ||
    presentation.protocol !== protocol ||
    presentation.replaySha256 !== report.replaySha256 ||
    !/^[a-f0-9]{64}$/.test(report.replaySha256) ||
    !Number.isFinite(presentation.endTime) ||
    presentation.endTime <= 0 ||
    !Number.isFinite(report.endTime) ||
    report.endTime <= 0 ||
    presentation.endTime > report.endTime ||
    presentation.legacyMotionEligibilityUnchanged !== true ||
    presentation.exactLegacyParticleTimelineAgreement !== false ||
    presentation.nativeAcceptance !== null ||
    presentation.rendered !== false ||
    presentation.complete !== null ||
    !Array.isArray(presentation.traces)
  )
    throw Error(
      "Matching direct missile presentation worker contract required",
    );
  const bindings = new Map(
    bindLatestMissileEffects(report, manifest).records.map((row) => [
      row.sequence,
      row,
    ]),
  );
  const endTime = presentation.endTime;
  const entries = new Map(),
    events = [];
  for (const trace of presentation.traces) {
    const records = report.missiles.filter(
      (record) =>
        record.sequence === trace.sequence &&
        record.entityId === trace.entityId,
    );
    const record = records[0],
      binding = bindings.get(trace.sequence);
    if (
      records.length !== 1 ||
      !identity(record.entityId) ||
      !identity(record.cast.ownerId) ||
      !ordinal(trace.sequence) ||
      !Number.isFinite(record.time) ||
      record.time < 0 ||
      entries.has(trace.sequence) ||
      !ordinal(record.transportSequence) ||
      !ordinal(record.entryOrder ?? 0) ||
      trace.ownerId !== record.cast.ownerId ||
      trace.startTime !== record.time ||
      !Number.isFinite(trace.stopTime) ||
      trace.stopTime < trace.startTime ||
      trace.stopTime > presentation.endTime ||
      binding?.status !== "prepared-definition" ||
      binding.effectId !== trace.effectId ||
      trace.effect?.definitionSha256 !== binding.definitionSha256 ||
      !Array.isArray(trace.states) ||
      !trace.states.length ||
      trace.states.length > 16000 ||
      trace.states[0].time !== trace.startTime
    )
      throw Error("Owned legacy-admitted missile source/binding required");
    let previous = trace.startTime;
    for (const state of trace.states) {
      if (
        !Number.isFinite(state.time) ||
        state.time < previous ||
        state.time > presentation.endTime ||
        !vector(state.position, 3) ||
        !vector(state.velocity, 3) ||
        !vector(state.direction, 3) ||
        !(Math.hypot(...state.direction) > 0) ||
        typeof state.stopped !== "boolean"
      )
        throw Error(
          "Finite ordered retained missile placement states required",
        );
      previous = state.time;
    }
    const id = instanceId(record),
      sourceEventId = sourceId(record);
    entries.set(trace.sequence, {
      trace: structuredClone(trace),
      record: structuredClone(record),
      id,
      sourceEventId,
    });
    const shared = {
      origin: "missile",
      entityId: trace.entityId,
      ownerId: trace.ownerId,
      ownershipStatus:
        "decoded-cast-owner-under-direct-missile-presentation-policy",
      transportSequence: record.transportSequence,
      entryOrder: record.entryOrder ?? 0,
      sourceEventId,
      definitionId: trace.effectId,
      missilePresentation: {
        policy: DIRECT_MISSILE_PRESENTATION_POLICY,
        sequence: trace.sequence,
        sourceEventId,
        nativeAcceptance: null,
        exactLegacyParticleTimelineAgreement: false,
        omissions: [...omissions],
      },
    };
    events.push({
      ...shared,
      id,
      kind: "create",
      time: trace.startTime,
      seedHex: "0",
      resourceSelection: {
        presentation: {
          policy: DIRECT_MISSILE_PRESENTATION_POLICY,
          nativeAcceptance: null,
          definitionSha256: binding.definitionSha256,
          omissions: [...omissions],
        },
      },
    });
    events.push({
      ...shared,
      id: `${id}:stop`,
      kind: "stop",
      time: trace.stopTime,
      orderingProvenance:
        "generated-under-declared-direct-clock-from-legacy-preview-stop",
    });
  }
  events.sort(order);
  return Object.freeze({
    policy: DIRECT_MISSILE_PRESENTATION_POLICY,
    events: structuredClone(events),
    placement(event, time) {
      const row = entries.get(event.missilePresentation?.sequence);
      if (
        !row ||
        event.kind !== "create" ||
        event.id !== row.id ||
        event.origin !== "missile" ||
        event.entityId !== row.trace.entityId ||
        event.ownerId !== row.trace.ownerId ||
        event.definitionId !== row.trace.effectId ||
        event.sourceEventId !== row.sourceEventId ||
        event.time !== row.trace.startTime ||
        event.transportSequence !== row.record.transportSequence ||
        event.entryOrder !== (row.record.entryOrder ?? 0) ||
        event.seedHex !== "0" ||
        event.missilePresentation.policy !== DIRECT_MISSILE_PRESENTATION_POLICY
      )
        throw Error("Owned direct missile placement request required");
      if (
        !Number.isFinite(time) ||
        time < row.trace.startTime ||
        time > endTime
      )
        return {
          resolved: false,
          policy: DIRECT_MISSILE_PRESENTATION_POLICY,
          reasons: ["world:direct-missile-outside-admitted-prefix"],
        };
      const pose = parentMissilePlacement(row.trace, time);
      return {
        resolved: true,
        policy: DIRECT_MISSILE_PRESENTATION_POLICY,
        position: [...pose.position],
        basis: pose.basis.filter((_, index) => index < 12 && index % 4 !== 3),
        basisStatus: "supplied-legacy-flight-basis-under-new-direct-clock",
        sourceEventId: row.sourceEventId,
        nativeAcceptance: null,
        reasons: [...omissions],
      };
    },
  });
}

// Intended for the existing browser preparation worker, never the render loop.
export async function loadLatestDirectMissilePresentation({
  profile,
  report,
  scene,
  terrain,
  manifest,
  load,
  endTime = report.endTime,
}) {
  if (
    profile.clientVersion !== report.build ||
    profile.protocolDigest !== report.protocol ||
    profile.decoderImageSha256 !== report.decoderImageSha256 ||
    profile.fieldCodecsSha256 !== report.fieldCodecsSha256 ||
    profile.constructorImageSha256 !== report.constructorImageSha256 ||
    scene.build !== report.build ||
    scene.protocol !== report.protocol
  )
    throw Error("Direct missile static/browser build mismatch");
  const definitions = {};
  for (const [name, key] of [
    ["motion", "missileMotionSha256"],
    ["controllers", "missileControllersSha256"],
    ["actors", "missileActorsSha256"],
  ]) {
    const bytes = await load(`decoder-16.21-macos/missile-${name}.json`);
    if ((await sha256(bytes)) !== profile[key])
      throw Error("Direct missile numeric package mismatch");
    definitions[name] = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (definitions[name].decoderImageSha256 !== profile.decoderImageSha256)
      throw Error("Direct missile kernel image mismatch");
  }
  const subjects = [];
  for (const hero of report.heroes) {
    const asset =
      scene.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`];
    if (!asset) throw Error("Direct missile owner static catalog missing");
    subjects.push({
      entityId: hero.entityId,
      character: hero.champion,
      catalog: JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await load(`latest-scene/${asset.spellCatalog}`),
        ),
      ),
    });
  }
  const controllers = createLatestMissileControllers(definitions.controllers),
    motion = createLatestMissileMotion(definitions.motion),
    frame = createLatestMissileFrame(
      definitions.controllers,
      motion,
      controllers,
      terrain,
    ),
    actors = createLatestMissileActors(definitions.actors);
  const analysis = analyzeLatestMissiles(report, subjects, definitions.motion, {
    manifest: scene,
    terrain,
    controllers,
    initialization: createLatestMissileInitialization(definitions.controllers),
    frame,
    actors,
  });
  return buildLatestDirectMissilePresentation({
    report,
    analysis,
    manifest,
    frame,
    actors,
    endTime,
  });
}
