// Inventory every declared row; recognition of a field or class does not admit
// event scheduling, resource binding, animation state or drawing.
export function compileSceneEventInventory(graphs) {
  const maps = [],
    nodeClasses = new Set();
  function visit(value, path, source) {
    if (!value || typeof value !== "object") return;
    if (typeof value.__type === "string") nodeClasses.add(value.__type);
    for (const field of ["mEventDataMap", "{f598463e}"]) {
      if (!Object.hasOwn(value, field)) continue;
      const table = value[field];
      if (!table || typeof table !== "object" || Array.isArray(table))
        throw Error("Original event map declarations required");
      const unresolved = table.__type === "UnresolvedOriginalBinMap";
      const entries = unresolved
        ? table.entries.map((row) => ({
            id: `${row.key}@source-row-${row.sourceEntry}`,
            originalKey: row.key,
            sourceEntry: row.sourceEntry,
            value: row.value,
          }))
        : Object.entries(table).map(([id, event]) => ({ id, value: event }));
      if (
        entries.some(
          (row) =>
            !row.value ||
            typeof row.value !== "object" ||
            typeof row.value.__type !== "string",
        )
      )
        throw Error("Original event class identity required");
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
        throw Error("Original event inventory row identities collide");
      for (const entry of entries)
        visit(entry.value, [...path, field, entry.id], source);
      maps.push({
        graph: source.file,
        graphSha256: source.sha256,
        owner: path,
        field,
        nativeClass: value.__type,
        nativeField: field === "{f598463e}" ? "f598463e" : null,
        nativeOrder: unresolved
          ? "unresolved-original-map"
          : source.nativeMapEvidence
            ? "see-bound-original-map-evidence"
            : "source-declarations-only",
        nativeMapEvidence: source.nativeMapEvidence ?? null,
        entries,
        schedulingAdmitted: false,
      });
    }
    for (const [key, child] of Object.entries(value))
      if (!["mEventDataMap", "{f598463e}"].includes(key))
        visit(child, [...path, key], source);
  }
  for (const source of graphs) visit(source.value, [], source);
  return {
    schema: 1,
    kind: "original-scene-animation-event-inventory",
    graphs: graphs.map(({ file, sha256, nativeMapEvidence }) => ({
      file,
      sha256,
      nativeMapEvidence: nativeMapEvidence ?? null,
    })),
    maps,
    nodeClasses: [...nodeClasses].sort(),
    capabilities: {
      eventSchedulingAdmitted: false,
      effectBindingsAdmitted: false,
      dynamicStateProgramAdmitted: false,
      nativeSpectatorAdmitted: false,
    },
  };
}
