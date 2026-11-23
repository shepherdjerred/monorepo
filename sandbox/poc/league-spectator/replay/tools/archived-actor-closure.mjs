import { actorObjectHash } from "./archived-actor-bin.mjs";

// Resolve links through original BIN dependency edges, retaining every original
// object. No filename/skin fallback is manufactured when a link is absent.
export function createActorBinClosure(source, wadName) {
  const files = new Map(),
    pending = [];
  async function load(file, knownPaths = []) {
    const key = file.toLowerCase();
    if (files.has(key)) return files.get(key);
    if (files.size >= 256)
      throw Error("Actor BIN dependency closure exceeds bounds");
    const bin = await source.bin(wadName, file, knownPaths);
    files.set(key, bin);
    for (const dependency of bin.tree.dependencies)
      if (
        !files.has(dependency.toLowerCase()) &&
        !pending.some((path) => path.toLowerCase() === dependency.toLowerCase())
      )
        pending.push(dependency);
    return bin;
  }
  function objects() {
    const entries = new Map();
    for (const bin of files.values())
      for (const [path, value] of Object.entries(bin.normalized)) {
        const hash = actorObjectHash(path);
        const original = bin.tree.objects.find(
          (node) => node.pathHash === hash,
        );
        if (
          entries.has(hash) &&
          JSON.stringify(entries.get(hash).original) !==
            JSON.stringify(original)
        )
          throw Error(
            `Conflicting original actor object across BIN dependencies: ${path}`,
          );
        if (!entries.has(hash))
          entries.set(hash, { entry: [path, value], original });
      }
    return [...entries.values()].map((value) => value.entry);
  }
  function known(reference) {
    const hash = actorObjectHash(reference);
    return objects().find(([path]) => actorObjectHash(path) === hash);
  }
  async function resolve(reference) {
    for (;;) {
      const found = known(reference);
      if (found)
        return {
          path: found[0],
          value: found[1],
          objects: Object.fromEntries(objects()),
        };
      if (!pending.length)
        throw Error(`Missing original actor dependency object ${reference}`);
      // This only prioritizes a file already declared by original metadata;
      // acceptance still requires its actual object hash to match the link.
      const hash = actorObjectHash(reference);
      const preferred = pending.findIndex(
        (file) =>
          actorObjectHash(
            file.replace(/^data\//i, "").replace(/\.bin$/i, ""),
          ) === hash,
      );
      const [file] = pending.splice(preferred < 0 ? 0 : preferred, 1);
      await load(file);
    }
  }
  return { load, resolve, objects, files: () => [...files.values()] };
}
