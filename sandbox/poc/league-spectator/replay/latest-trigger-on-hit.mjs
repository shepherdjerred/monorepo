// Inactive shared component translation. Original TriggerOnHit has its own
// authored action list/factory even though it shares CastOnHit's runtime class.
export const TRIGGER_ON_HIT_NO_HIT_POLICY =
  "original-trigger-on-hit-no-hit-local-isolation-v1";
export const TRIGGER_ON_HIT_CONTRACT = Object.freeze({
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  specConstructorRva: 0x86f770,
  specVtableRva: 0x235b5f0,
  factoryRva: 0x868730,
  runtimeVtableRva: 0x235df20,
  phaseRva: 0x8838b0,
  frameRva: 0x8838e0,
  hitRva: 0x875c90,
  castActionFactoryRva: 0x8692d0,
  castActionVtableRva: 0x235c610,
});

export function createTriggerOnHitNoHitActors(
  base,
  contract = TRIGGER_ON_HIT_CONTRACT,
) {
  if (
    Object.entries(TRIGGER_ON_HIT_CONTRACT).some(
      ([key, value]) => contract?.[key] !== value,
    ) ||
    [
      "settings",
      "initialize",
      "advancePhase",
      "componentFrame",
      "afterMovement",
      "phaseNotification",
      "stop",
    ].some((key) => typeof base?.[key] !== "function")
  )
    throw Error(
      "Original TriggerOnHit contract and shared presentation actors required",
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
      if (spec?.__type !== "TriggerOnHit") {
        const result = base.settings([spec]);
        reasons.push(...result.reasons);
        if (result.components) components.push(...result.components);
        continue;
      }
      if (
        Object.keys(spec).some((key) => !["__type", "mActions"].includes(key))
      )
        reasons.push("properties:TriggerOnHit");
      if (!Array.isArray(spec.mActions) || spec.mActions.length !== 1)
        reasons.push("actions:TriggerOnHit-single-Cast-required");
      else if (
        spec.mActions[0]?.__type !== "Cast" ||
        Object.keys(spec.mActions[0]).some((key) => key !== "__type")
      )
        reasons.push("actions:TriggerOnHit-Cast-type-or-properties");
      components.push({
        type: "TriggerOnHit",
        settings: { actions: [{ type: "Cast" }] },
      });
    }
    return {
      status: reasons.length
        ? "unprepared"
        : "original-no-hit-phase-frame-isolation",
      reasons,
      components: reasons.length ? null : components,
    };
  }
  function initialize(record, velocity, source) {
    const admission = settings(record.behaviorSpecs);
    if (admission.reasons.length)
      throw Error(
        "Unsupported TriggerOnHit no-hit component: " +
          admission.reasons.join(","),
      );
    const state = base.initialize(
      {
        ...record,
        behaviorSpecs: record.behaviorSpecs.filter(
          (spec) => spec.__type !== "TriggerOnHit",
        ),
      },
      velocity,
      source,
    );
    const existing = [...state.components];
    let next = 0;
    state.components = admission.components.map((component, index) =>
      component.type === "TriggerOnHit"
        ? {
            ...component,
            componentIndex: index,
            actions: [{ type: "Cast", executed: false }],
          }
        : { ...existing[next++], componentIndex: index },
    );
    if (next !== existing.length)
      throw Error("Original ordered component inventory differs");
    return state;
  }
  return Object.freeze({
    policy: TRIGGER_ON_HIT_NO_HIT_POLICY,
    settings,
    initialize,
    advancePhase: base.advancePhase,
    componentFrame: base.componentFrame,
    afterMovement: base.afterMovement,
    phaseNotification: base.phaseNotification,
    stop: base.stop,
    hit() {
      throw Error(
        "TriggerOnHit collision and downstream Cast dispatch remain untranslated",
      );
    },
    omissions: Object.freeze([
      "collision:TriggerOnHit-and-Cast-actions-unimplemented",
    ]),
    nativeMatchAccepted: false,
  });
}
