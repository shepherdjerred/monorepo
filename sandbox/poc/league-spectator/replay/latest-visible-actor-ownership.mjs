// Retain authoritative replay records independently of transient render objects.
// Visibility is supplied by the admitted native lifecycle/corpse policy; this
// owner makes no health, duration, distance or spawn-order assumptions.
export function createLatestVisibleActorOwnership({
  entries,
  visible,
  create,
  release,
}) {
  if (
    !Array.isArray(entries) ||
    [visible, create, release].some((fn) => typeof fn !== "function")
  )
    throw Error(
      "Visible actor ownership requires records and lifecycle callbacks",
    );
  const instances = new Map();
  let disposed = false;
  return {
    reconcile(time) {
      if (disposed) throw Error("Visible actor ownership is disposed");
      if (!Number.isFinite(time))
        throw Error("Actor presentation time must be finite");
      // Release retired instances before allocating a seek destination. Original
      // entity records and their event identities remain intact for backwards seeks.
      const active = [];
      for (const entry of entries) {
        const present = visible(entry, time);
        if (typeof present !== "boolean")
          throw Error("Actor visibility must be explicit");
        if (present) active.push(entry);
        else if (instances.has(entry)) {
          const instance = instances.get(entry);
          instances.delete(entry);
          release(instance, entry);
        }
      }
      for (const entry of active) {
        if (!instances.has(entry)) {
          const instance = create(entry);
          if (!instance || typeof instance.then === "function")
            throw Error(
              "Prepared actor instances must be created synchronously",
            );
          instances.set(entry, instance);
        }
      }
      return active;
    },
    get(entry) {
      return instances.get(entry) ?? null;
    },
    get size() {
      return instances.size;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [entry, instance] of instances) release(instance, entry);
      instances.clear();
    },
  };
}
