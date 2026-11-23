// Private persistent insertion-order storage for complete checkpoint history.
// Updating one row copies a 32-way tree path, never the complete historical Map.
// Values are detached on insertion and leave this owner only as detached copies.
export function createDirectCheckpointHistory() {
  const snapshots = new WeakMap();
  let root = Object.freeze([]),
    depth = 0,
    length = 0,
    indices = new Map(),
    updates = 0;
  const capacity = (level) => 32 ** (level + 1);
  function write(node, level, index, entry) {
    const next = node?.slice() ?? [];
    const slot = Math.floor(index / 32 ** level) % 32;
    next[slot] = level ? write(node?.[slot], level - 1, index, entry) : entry;
    return Object.freeze(next);
  }
  function* entries(node, level) {
    for (const value of node) {
      if (level) yield* entries(value, level - 1);
      else yield value;
    }
  }
  function saved(handle) {
    const state = snapshots.get(handle);
    if (!state)
      throw Error("Owned direct checkpoint history snapshot required");
    return state;
  }
  function setOwned(key, value) {
    if (typeof key !== "string")
      throw Error("Checkpoint history requires an exact string key");
    let index = indices.get(key);
    if (index === undefined) {
      index = length++;
      indices.set(key, index);
    }
    while (index >= capacity(depth)) {
      root = Object.freeze([root]);
      depth++;
    }
    root = write(root, depth, index, Object.freeze([key, value]));
    updates++;
  }
  function setOwnedEntries(changes) {
    if (!changes.length) return;
    for (const [key] of changes)
      if (typeof key !== "string")
        throw Error("Checkpoint history requires an exact string key");
    const indexed = changes.map(([key, value]) => {
      let index = indices.get(key);
      if (index === undefined) {
        index = length++;
        indices.set(key, index);
      }
      return [index, Object.freeze([key, value])];
    });
    while (length > capacity(depth)) {
      root = Object.freeze([root]);
      depth++;
    }
    const writable = new WeakSet(),
      copied = [];
    const own = (node) => {
      if (node && writable.has(node)) return node;
      const next = node?.slice() ?? [];
      writable.add(next);
      copied.push(next);
      return next;
    };
    root = own(root);
    for (const [index, entry] of indexed) {
      let node = root;
      for (let level = depth; level > 0; level--) {
        const slot = Math.floor(index / 32 ** level) % 32;
        node[slot] = own(node[slot]);
        node = node[slot];
      }
      node[index % 32] = entry;
    }
    for (const node of copied) Object.freeze(node);
    updates += changes.length;
  }
  function snapshot(payload) {
    const handle = Object.freeze({});
    snapshots.set(handle, { root, depth, length, payload });
    return handle;
  }
  return {
    set(key, value) {
      setOwned(key, structuredClone(value));
    },
    snapshot: () => snapshot(undefined),
    // Copy changed rows and active state together so shared mutable lifecycle
    // arrays keep their identity inside this private, detached checkpoint.
    snapshotWithEntries(changes, payload) {
      const copied = structuredClone({ changes, payload });
      setOwnedEntries(copied.changes);
      return snapshot(copied.payload);
    },
    cloneState(handle) {
      const state = saved(handle);
      return structuredClone({
        entries: [...entries(state.root, state.depth)],
        payload: state.payload,
      });
    },
    cloneEntries(handle) {
      const state = saved(handle);
      return structuredClone([...entries(state.root, state.depth)]);
    },
    restore(handle) {
      const state = saved(handle);
      ({ root, depth, length } = state);
      indices = new Map();
      let index = 0;
      for (const [key] of entries(root, depth)) indices.set(key, index++);
      if (index !== length)
        throw Error("Checkpoint history tree length differs");
    },
    clear() {
      root = Object.freeze([]);
      depth = 0;
      length = 0;
      indices.clear();
    },
    metrics: () => ({ rows: length, updates, depth }),
  };
}
