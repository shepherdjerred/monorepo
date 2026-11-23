// A receiving worker already owns its structured-cloned message graph. This
// single-use handoff avoids copying that complete event graph again inside the
// runtime. Ordinary in-process callers retain the constructor's copy boundary.
const inputs = new WeakMap();
export function ownDirectWorkerEventInput(events) {
  if (!Array.isArray(events)) throw Error("Worker-owned event array required");
  const ownership = Object.freeze({});
  inputs.set(ownership, events);
  return ownership;
}
export function consumeDirectWorkerEventInput(ownership, events) {
  if (!ownership || inputs.get(ownership) !== events)
    throw Error("Unused ownership for this worker event array required");
  inputs.delete(ownership);
  return events;
}
