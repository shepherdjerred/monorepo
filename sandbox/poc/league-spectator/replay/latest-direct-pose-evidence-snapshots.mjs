// Placement queries can share the same immutable pose observation among many
// effects at one causal clock. Clone that observation once per runtime, while
// preserving independent snapshots for mutable or externally backed inputs.
import { isDirectImmutableData } from "./latest-direct-immutable-data.mjs";

export function createDirectPoseEvidenceSnapshots() {
  const snapshots = new WeakMap();
  function immutableSnapshot(value) {
    if (value === null || typeof value !== "object") return value;
    const previous = snapshots.get(value);
    if (previous) return previous;
    // Match structuredClone's enumerable own data and normalized prototypes.
    // This branch has already excluded accessors and mutable backing stores.
    const snapshot = Array.isArray(value) ? new Array(value.length) : {};
    snapshots.set(value, snapshot);
    for (const key of Object.keys(value))
      Object.defineProperty(snapshot, key, {
        value: immutableSnapshot(value[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    return Object.freeze(snapshot);
  }
  return (evidence) => {
    const previous = snapshots.get(evidence);
    if (previous) return previous;
    if (isDirectImmutableData(evidence)) {
      return immutableSnapshot(evidence);
    }
    return structuredClone(evidence);
  };
}
