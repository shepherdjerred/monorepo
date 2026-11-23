const [file] = process.argv.slice(2);
if (!file || process.argv.length !== 3)
  throw Error(
    "Usage: bun inspect-actor-maps.mjs <normalized-actor-graph.json>",
  );
const graph = await Bun.file(file).json();
function inspect(value, path) {
  if (!value || typeof value !== "object") return;
  if (value.__type === "UnresolvedOriginalBinMap") {
    const groups = new Map();
    for (const entry of value.original.entries) {
      const key = JSON.stringify(entry.key);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry.value);
    }
    const repeated = [...groups.entries()].filter(
      ([, entries]) => entries.length > 1,
    );
    console.log(
      JSON.stringify({
        path,
        entries: value.original.entries.length,
        uniqueKeys: groups.size,
        repeated: repeated.map(([key, entries]) => ({
          key: JSON.parse(key),
          count: entries.length,
          distinctOriginalValues: new Set(
            entries.map((entry) => JSON.stringify(entry)),
          ).size,
          classes: entries.map((entry) => entry.classHash),
        })),
      }),
    );
    return;
  }
  for (const [key, entry] of Object.entries(value))
    inspect(entry, [...path, key]);
}
inspect(graph, []);
