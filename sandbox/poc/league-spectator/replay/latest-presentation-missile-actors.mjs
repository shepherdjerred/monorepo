// Original local phase/action behavior. The downstream spell dispatcher is an
// identifiable emitted request, not a claim that its presentation was rendered.
const f = Math.fround;
export const CAST_ON_COMPLETION_CONTRACT = Object.freeze({
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  factoryRva: 0x869d30,
  parentPhaseRva: 0x8758a0,
  parentFrameRva: 0x875940,
  actionRva: 0x8762b0,
  normalizationRva: 0x148a750,
  castDispatcherRva: 0x8b5740,
});
export function normalizeCompletionCastDirection(input) {
  if (
    !Array.isArray(input) ||
    input.length !== 3 ||
    input.some((v) => !Number.isFinite(v) || !Number.isFinite(f(v)))
  )
    throw Error("Finite float32 completion-cast velocity required");
  const v = input.map(f),
    square = f(f(v[2] * v[2]) + f(f(v[0] * v[0]) + f(v[1] * v[1])));
  if (!(square > f(1e-9))) return v;
  const inverse = f(1 / f(Math.sqrt(square)));
  return v.map((lane) => f(lane * inverse));
}

export function createPresentationMissileActors(
  base,
  contract = CAST_ON_COMPLETION_CONTRACT,
) {
  if (
    Object.entries(CAST_ON_COMPLETION_CONTRACT).some(
      ([key, value]) => contract?.[key] !== value,
    ) ||
    typeof base?.settings !== "function" ||
    typeof base?.initialize !== "function" ||
    typeof base?.stop !== "function"
  )
    throw Error(
      "Exact original completion-action contract and shared actor kernels required",
    );
  function settings(specs) {
    if (!Array.isArray(specs))
      return {
        status: "unprepared",
        reasons: ["behavior-specifications"],
        components: null,
      };
    const reasons = [],
      components = [];
    for (const spec of specs) {
      if (spec?.__type === "CastOnMovementComplete") {
        if (Object.keys(spec).some((key) => key !== "__type"))
          reasons.push("properties:CastOnMovementComplete");
        else components.push({ type: spec.__type, settings: {} });
      } else {
        const result = base.settings([spec]);
        reasons.push(...result.reasons);
        if (result.components) components.push(...result.components);
      }
    }
    return {
      status: reasons.length
        ? "unprepared"
        : "phase-frame-and-emitted-cast-request-translated",
      reasons,
      components: reasons.length ? null : components,
    };
  }
  function initialize(record, velocity, source) {
    const admission = settings(record.behaviorSpecs);
    if (
      admission.reasons.length ||
      record.pendingChildren !== 0 ||
      record.replicationPhase !== 0
    )
      throw Error(
        `Unprepared completion-action initialization: ${admission.reasons.join(",") || "initial-phase-or-children"}`,
      );
    if (
      !source ||
      typeof source.instanceId !== "string" ||
      !source.instanceId.length ||
      typeof source.sourceEventId !== "string" ||
      !source.sourceEventId.length ||
      !Number.isInteger(record.entityId) ||
      record.entityId <= 0 ||
      record.entityId > 0xffffffff
    )
      throw Error(
        "Traceable missile presentation instance and source event required",
      );
    const filtered = record.behaviorSpecs.filter(
      (spec) => spec.__type !== "CastOnMovementComplete",
    );
    const state = base.initialize(
      { ...record, behaviorSpecs: filtered },
      velocity,
    );
    const existing = [...state.components];
    state.components = admission.components.map((component, index) => {
      if (component.type === "CastOnMovementComplete")
        return {
          ...component,
          remainingDelay: 0,
          fired: false,
          actionExecuted: false,
          actionGeneration: 0,
          componentIndex: index,
        };
      const found = existing.findIndex(
        (candidate) => candidate.type === component.type,
      );
      if (found < 0) throw Error("Shared actor component ordering differs");
      return { ...existing.splice(found, 1)[0], componentIndex: index };
    });
    state.castRequests = [];
    state.presentationSource = {
      ...source,
      entityId: record.entityId,
      cast: structuredClone(record.cast),
    };
    return state;
  }
  function advancePhase(state, now, trigger = null) {
    if (!Number.isFinite(now) || now < 0)
      throw Error("Supplied completion-action replay clock required");
    state.phase = (state.phase + 1) & 255;
    if (state.phaseLatch) return;
    for (const component of state.components) {
      if (
        !["CastOnMovementComplete", "DestroyOnMovementComplete"].includes(
          component.type,
        ) ||
        component.fired
      )
        continue;
      if (component.remainingDelay > 0) {
        component.remainingDelay--;
        continue;
      }
      if (component.type === "DestroyOnMovementComplete") base.stop(state);
      else {
        const source = state.presentationSource,
          generation = ++component.actionGeneration;
        state.castRequests.push({
          id: `${source.instanceId}:completion-cast:${component.componentIndex}:${generation}`,
          origin: "translated-missile-behavior",
          kind: "omitted-cast-presentation-request",
          sourceEventId: source.sourceEventId,
          sourceInstanceId: source.instanceId,
          missileEntityId: source.entityId,
          componentIndex: component.componentIndex,
          actionGeneration: generation,
          time: now,
          phase: state.phase,
          normalizedDirection: normalizeCompletionCastDirection(state.velocity),
          sourceCastRequest: structuredClone(source.cast),
          trigger: structuredClone(trigger),
          dispatcherRva: contract.castDispatcherRva,
          omissions: [
            "presentation:downstream-original-cast-and-child-spawn-unimplemented",
          ],
          rendered: false,
          nativeWorldAcceptance: null,
        });
      }
      component.actionExecuted = true;
      component.fired = true;
    }
  }
  function componentFrame(state, arrived) {
    if (typeof arrived !== "boolean")
      throw Error("Verified controller completion result required");
    if (!arrived)
      for (const component of state.components)
        if (
          ["CastOnMovementComplete", "DestroyOnMovementComplete"].includes(
            component.type,
          ) &&
          component.fired
        ) {
          component.actionExecuted = false;
          component.fired = false;
        }
  }
  function afterMovement(state, arrived, now) {
    if (typeof arrived !== "boolean")
      throw Error("Verified controller completion result required");
    if (arrived) {
      advancePhase(state, now, {
        kind: "supplied-controller-arrival",
        id: `${state.presentationSource.instanceId}:arrival:${now}`,
      });
      state.phaseLatch = state.phase >= state.phaseCount;
    } else state.phaseLatch = false;
    componentFrame(state, arrived);
  }
  function phaseNotification(state, target, now, trigger = null) {
    if (!Number.isInteger(target) || target < 0 || target > 255)
      throw Error("Original phase byte required");
    while (state.phase < target) advancePhase(state, now, trigger);
  }
  return Object.freeze({
    settings,
    initialize,
    advancePhase,
    componentFrame,
    afterMovement,
    phaseNotification,
    stop: base.stop,
    omissions: Object.freeze([
      "presentation:downstream-original-cast-and-child-spawn-unimplemented",
    ]),
  });
}
