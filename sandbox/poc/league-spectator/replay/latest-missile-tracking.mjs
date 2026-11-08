// Shared target-query/retention slice. The caller supplies accepted internal
// target views; this module cannot turn a decoded network ID into acceptance.
const f = Math.fround;
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const vector = (v) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => typeof n === "number" && Number.isFinite(f(n)));
export const MISSILE_TRACKING_OMISSIONS = Object.freeze([
  "target:network-to-accepted-internal-identity-unrecovered",
  "target:recorded-visibility-and-mode-inputs-unrecovered",
  "target:bone-query-unimplemented",
  "target:packet-retarget-and-reacquisition-unimplemented",
  "target:holder-history-and-smoothing-unimplemented",
  "motion:actor-position-application-not-in-this-slice",
  "clock:recorded-frame-cadence-unrecovered",
]);

export function createLatestMissileTracking(contract) {
  if (
    contract.build !== "16.21.829.8620" ||
    contract.protocol !== "20e09df23c66b85e" ||
    contract.targetQueryRva !== 0x88b5e0 ||
    contract.controllerQueryRva !== 0x88b500 ||
    contract.controllerFrameRva !== 0x88b760
  )
    throw Error("Unsupported exact-build missile target-query contract");
  function query({
    internalId,
    target,
    skipHidden,
    modeValue,
    heightAugment,
    boneHash = 0,
  }) {
    if (
      !uint(internalId) ||
      !uint(modeValue) ||
      !uint(boneHash) ||
      typeof skipHidden !== "boolean" ||
      typeof heightAugment !== "number" ||
      !Number.isFinite(f(heightAugment))
    )
      throw Error("Explicit bounded missile target-query inputs required");
    if (
      target !== null &&
      (!target ||
        !uint(target.internalId) ||
        target.kind !== "supplied-ai-query-view" ||
        !vector(target.position) ||
        !vector(target.aimOffset) ||
        typeof target.visible !== "boolean" ||
        typeof target.radius !== "number" ||
        !Number.isFinite(f(target.radius)))
    )
      throw Error("Explicit accepted internal AI target view required");
    if (!internalId || target === null || target.internalId !== internalId)
      return {
        resolved: false,
        reason: "target:internal-reference-unaccepted",
      };
    if (!target.visible && skipHidden && modeValue === 0)
      return { resolved: false, reason: "target:visibility-query-rejected" };
    if (boneHash !== 0)
      return { resolved: false, reason: "target:bone-query-unimplemented" };
    return {
      resolved: true,
      position: [
        f(target.position[0]),
        f(f(target.position[1]) + f(heightAugment)),
        f(target.position[2]),
      ],
      aimOffset: target.aimOffset.map(f),
      radius: f(target.radius),
    };
  }
  function update(state, target, modeValue, initial = false) {
    const result = query({
      internalId: state.holderInternalId,
      target,
      skipHidden: initial ? false : !state.tracksHidden,
      modeValue,
      heightAugment: state.heightAugment,
      boneHash: state.boneHash,
    });
    if (result.resolved) {
      state.targetPosition = result.position;
      state.aimOffset = result.aimOffset;
      state.radius = result.radius;
    }
    state.lastQuery = result.resolved
      ? "accepted-supplied-internal-target"
      : result.reason;
    return result;
  }
  function initialize({
    tracksTarget,
    tracksHidden,
    acceptedInternalId,
    endpoint,
    heightAugment,
    boneHash = 0,
    target,
    modeValue,
  }) {
    if (
      typeof tracksTarget !== "boolean" ||
      typeof tracksHidden !== "boolean" ||
      !uint(acceptedInternalId) ||
      !vector(endpoint)
    )
      throw Error("Explicit missile tracking initialization required");
    const state = {
      holderInternalId: tracksTarget ? acceptedInternalId : 0,
      tracksHidden,
      heightAugment,
      boneHash,
      targetPosition: endpoint.map(f),
      aimOffset: [0, 0, 0],
      radius: 0,
      lastQuery: null,
    };
    update(state, target, modeValue, true);
    return state;
  }
  return Object.freeze({
    query,
    initialize,
    update,
    omissions: MISSILE_TRACKING_OMISSIONS,
    actualMatchAdmitted: false,
  });
}
