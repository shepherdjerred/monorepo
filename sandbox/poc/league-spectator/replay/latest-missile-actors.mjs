// Exact-build phase/stop operations on owned no-child actors. Component admission
// covers phase/frame callbacks only; CastOnHit's collision/cast action, actor
// registries and particle lifetime are deliberately not inferred here.
export function createLatestMissileActors(definition) {
  if (
    definition.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    definition.phaseAdvanceRva !== 0x864a60 ||
    definition.stopRva !== 0x865150 ||
    definition.behaviors.DestroyOnMovementComplete.phaseRva !== 0x8758a0 ||
    definition.behaviors.CastOnHit.phaseRva !== 0x8838b0
  )
    throw Error("Unsupported missile actor package");
  const byte = (value) => {
    if (!Number.isInteger(value) || value < 0 || value > 255)
      throw Error("Invalid missile phase byte");
    return value;
  };
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
      const type = definition.behaviors[spec.__type];
      if (!type) {
        reasons.push(`behavior:${spec.__type}`);
        continue;
      }
      const uninterpreted = Object.keys(spec).filter(
        (name) => name !== "__type" && !Object.hasOwn(type.fields, name),
      );
      if (uninterpreted.length) {
        reasons.push(`properties:${spec.__type}:${uninterpreted.join(",")}`);
        continue;
      }
      const values = {};
      for (const [name, field] of Object.entries(type.fields)) {
        const value = Object.hasOwn(spec, name) ? spec[name] : field.default;
        if (
          (field.type === "bool" && typeof value !== "boolean") ||
          (field.type === "i32" &&
            (!Number.isInteger(value) ||
              value < -2147483648 ||
              value > 2147483647))
        )
          throw Error(`Invalid missile behavior property ${name}`);
        values[name] = value;
      }
      components.push({ type: spec.__type, settings: values });
    }
    return {
      status: reasons.length
        ? "unprepared"
        : "phase-frame-callbacks-translated",
      reasons,
      components: reasons.length ? null : components,
    };
  }
  function stop(state) {
    // Original stop always sends the presentation notification, even repeatedly.
    // Children must be handled by the separately established identity registry.
    state.velocity = [0, 0, 0];
    state.presentationStopCalls++;
    state.stopped = true;
  }
  function advancePhase(state) {
    state.phase = (state.phase + 1) & 255;
    if (state.phaseLatch) return;
    for (const component of state.components) {
      if (component.type !== "DestroyOnMovementComplete" || component.fired)
        continue;
      if (component.remainingDelay > 0) component.remainingDelay--;
      else {
        stop(state);
        component.actionExecuted = true;
        component.fired = true;
      }
    }
  }
  function phaseNotification(state, target) {
    target = byte(target);
    while (state.phase < target) advancePhase(state);
  }
  function applyReplication(state, record) {
    state.pendingChildren = byte(record.pendingChildren);
    const phase = byte(record.replicationPhase);
    if (state.pendingChildren) state.deferredPhase = phase;
    else phaseNotification(state, phase);
  }
  function releaseChildGate(state) {
    if (state.pendingChildren && --state.pendingChildren === 0)
      phaseNotification(state, state.deferredPhase);
  }
  function afterMovement(state, arrived) {
    if (typeof arrived !== "boolean")
      throw Error("Invalid controller completion flag");
    if (arrived) {
      advancePhase(state);
      state.phaseLatch = state.phase >= state.phaseCount;
    } else state.phaseLatch = false;
    for (const component of state.components) {
      if (
        component.type === "DestroyOnMovementComplete" &&
        component.fired &&
        !arrived
      ) {
        component.actionExecuted = false;
        component.fired = false;
      }
    }
  }
  function initialize(record, initialVelocity = [0, 0, 0]) {
    const prepared = settings(record.behaviorSpecs);
    if (prepared.reasons.length)
      throw Error(
        `Unprepared missile phase components: ${prepared.reasons.join(", ")}`,
      );
    if (
      initialVelocity.length !== 3 ||
      !initialVelocity.every(
        (value) =>
          Number.isFinite(value) && Number.isFinite(Math.fround(value)),
      )
    )
      throw Error("Invalid actor velocity");
    const defaults = definition.actorDefaults;
    const state = {
      phase: defaults.phase,
      deferredPhase: defaults.deferredPhase,
      pendingChildren: defaults.pendingChildren,
      phaseCount: defaults.phaseCount,
      phaseLatch: !!defaults.phaseLatch,
      stopped: !!defaults.stopped,
      renderParticlesAfterDestroy: !!defaults.renderParticlesAfterDestroy,
      velocity: initialVelocity.map(Math.fround),
      presentationStopCalls: 0,
      components: prepared.components.map((component) => ({
        ...component,
        ...(component.type === "DestroyOnMovementComplete"
          ? {
              remainingDelay: component.settings.mDelay,
              fired: false,
              actionExecuted: false,
            }
          : {}),
      })),
    };
    for (const component of state.components)
      if (component.type === "DestroyOnMovementComplete")
        state.renderParticlesAfterDestroy =
          component.settings.RenderParticlesAfterDestroy;
    applyReplication(state, record);
    // Native manager computes the count AFTER packet phase callbacks, using the
    // component's remaining delay rather than its original static mDelay.
    state.phaseCount =
      (state.phaseCount +
        Math.max(0, ...state.components.map((c) => c.remainingDelay ?? 0))) &
      255;
    return state;
  }
  function snapshot(state) {
    return {
      phase: state.phase,
      deferredPhase: state.deferredPhase,
      pendingChildren: state.pendingChildren,
      phaseCount: state.phaseCount,
      phaseLatch: state.phaseLatch,
      stopped: state.stopped,
      renderParticlesAfterDestroy: state.renderParticlesAfterDestroy,
      velocity: [...state.velocity],
      presentationStopCalls: state.presentationStopCalls,
      components: state.components.map((c) =>
        c.type === "DestroyOnMovementComplete"
          ? {
              type: c.type,
              remainingDelay: c.remainingDelay,
              fired: c.fired,
              actionExecuted: c.actionExecuted,
            }
          : { type: c.type },
      ),
    };
  }
  return {
    settings,
    initialize,
    applyReplication,
    advancePhase,
    phaseNotification,
    releaseChildGate,
    afterMovement,
    stop,
    snapshot,
  };
}
