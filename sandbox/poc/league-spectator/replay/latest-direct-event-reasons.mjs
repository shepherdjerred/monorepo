// Omitted-event reasons are live ledger state. Keep original ordered event
// inputs pristine and give aliases one working array per restored replay state.
const object = (value) => value !== null && typeof value === "object";
function children(value) {
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return [];
  if (value instanceof Map) return [...value].flat();
  if (value instanceof Set) return [...value];
  return Reflect.ownKeys(value).flatMap((key) => {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(property, "value"))
      throw Error("Event reason aliases require own data");
    return [property.value];
  });
}
function relink(value, replacements, seen = new WeakSet()) {
  if (!object(value)) return value;
  if (replacements.has(value)) return replacements.get(value);
  if (
    seen.has(value) ||
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer
  )
    return value;
  seen.add(value);
  if (value instanceof Map) {
    const entries = [...value].map(([key, child]) => [
      relink(key, replacements, seen),
      relink(child, replacements, seen),
    ]);
    value.clear();
    for (const [key, child] of entries) value.set(key, child);
  } else if (value instanceof Set) {
    const entries = [...value].map((child) =>
      relink(child, replacements, seen),
    );
    value.clear();
    for (const child of entries) value.add(child);
  } else
    for (const key of Reflect.ownKeys(value)) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!Object.hasOwn(property, "value"))
        throw Error("Restored event reason aliases require own data");
      const next = relink(property.value, replacements, seen);
      if (next !== property.value) value[key] = next;
    }
  return value;
}
const sameReasons = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === b.length &&
  a.every((value, index) => typeof value === "string" && value === b[index]);

export function createDirectEventReasonOwnership(events) {
  const sources = [],
    sourceIds = new WeakMap(),
    omittedIds = new Map(),
    cache = new WeakMap(),
    creationIds = new Map();
  let working = new Map(),
    workingIds = new WeakMap(),
    ledgerOwners = new Map();
  for (const event of events)
    if (event.kind === "omitted") {
      if (
        !Array.isArray(event.reasons) ||
        !event.reasons.every((value) => typeof value === "string")
      )
        throw Error("Omitted event reasons must be original string inputs");
      let id = sourceIds.get(event.reasons);
      if (id === undefined) {
        id = sources.length;
        sources.push(event.reasons);
        sourceIds.set(event.reasons, id);
      }
      omittedIds.set(event.id, id);
    }
  function own(id) {
    if (!working.has(id)) {
      const value = sources[id].slice();
      working.set(id, value);
      workingIds.set(value, id);
    }
    return working.get(id);
  }
  function registerOwner(id, key) {
    const prior = ledgerOwners.get(id);
    if (prior === undefined) ledgerOwners.set(id, key);
    else if (typeof prior === "string") {
      if (prior !== key) ledgerOwners.set(id, new Set([prior, key]));
    } else prior.add(key);
  }
  const owners = (id) => {
    const value = ledgerOwners.get(id);
    return value === undefined
      ? []
      : typeof value === "string"
        ? [value]
        : [...value];
  };
  function references(root) {
    if (cache.has(root)) return cache.get(root);
    const nodes = new Map(),
      queue = [];
    function collect(value, parent = null) {
      if (!object(value)) return;
      let node = nodes.get(value);
      if (!node) {
        node = { value, parents: new Set(), ids: new Set() };
        nodes.set(value, node);
        const source = sourceIds.get(value),
          known = cache.get(value);
        if (source !== undefined) node.ids.add(source);
        else if (known) for (const id of known) node.ids.add(id);
        else for (const child of children(value)) collect(child, node);
        if (node.ids.size) queue.push(node);
      }
      if (parent) node.parents.add(parent);
    }
    collect(root);
    for (let index = 0; index < queue.length; index++)
      for (const parent of queue[index].parents) {
        let changed = false;
        for (const id of queue[index].ids)
          if (!parent.ids.has(id)) {
            parent.ids.add(id);
            changed = true;
          }
        if (changed) queue.push(parent);
      }
    for (const node of nodes.values()) cache.set(node.value, [...node.ids]);
    return cache.get(root);
  }
  return {
    creation(event, certifiedImmutable = false) {
      const ids = certifiedImmutable ? [] : references(event);
      if (!ids.length) return event;
      creationIds.set(event.id, ids);
      const cloned = structuredClone({
        event,
        bindings: ids.map((id) => [id, sources[id]]),
      });
      return relink(
        cloned.event,
        new Map(cloned.bindings.map(([id, value]) => [value, own(id)])),
      );
    },
    omitted(event) {
      const id = omittedIds.get(event.id);
      if (id === undefined)
        throw Error("Original omitted event reason identity required");
      registerOwner(id, event.id);
      return own(id);
    },
    changed(value) {
      const id = workingIds.get(value);
      return id === undefined ? [] : owners(id);
    },
    checkpoint(instances) {
      const ids = new Set(),
        dirty = new Set();
      for (const instance of instances.values())
        for (const id of creationIds.get(instance.event.id) ?? []) {
          ids.add(id);
          for (const key of owners(id)) dirty.add(key);
        }
      return {
        bindings: [...ids].map((id) => [id, own(id)]),
        dirty: [...dirty],
      };
    },
    restore(state) {
      if (!Array.isArray(state.reasonBindings))
        throw Error("Owned source-reason checkpoint bindings required");
      const nextWorking = new Map(),
        nextWorkingIds = new WeakMap(),
        nextOwners = new Map();
      const replacements = new Map();
      function bind(id, value) {
        if (
          !Number.isInteger(id) ||
          !sources[id] ||
          !Array.isArray(value) ||
          value.some((reason) => typeof reason !== "string")
        )
          throw Error("Invalid source-reason checkpoint identity/value");
        if (!nextWorking.has(id)) {
          nextWorking.set(id, value);
          nextWorkingIds.set(value, id);
        } else if (!sameReasons(nextWorking.get(id), value))
          throw Error("Aliased checkpoint reasons have unequal versions");
        replacements.set(value, nextWorking.get(id));
      }
      for (const [key, row] of state.ledger) {
        const id = omittedIds.get(key);
        if (id !== undefined) {
          bind(id, row.reasons);
          if (!nextOwners.has(id)) nextOwners.set(id, key);
          else {
            const prior = nextOwners.get(id);
            if (typeof prior === "string")
              nextOwners.set(id, new Set([prior, key]));
            else prior.add(key);
          }
        }
      }
      const ids = new Set();
      for (const [id, value] of state.reasonBindings) {
        if (ids.has(id))
          throw Error("Repeated source-reason checkpoint binding");
        ids.add(id);
        bind(id, value);
      }
      relink(state, replacements);
      working = nextWorking;
      workingIds = nextWorkingIds;
      ledgerOwners = nextOwners;
    },
  };
}
