import { actorObjectHash } from "./archived-actor-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";

// Candidate physical paths are search seeds, never a substitute object or skin.
// Only an exact original object hash and class can satisfy a requested target.
export async function findArchivedActorObjects({
  source,
  archive,
  wad,
  seeds,
  targets,
  maxFiles = 256,
}) {
  const pending = [...seeds],
    visited = new Set(),
    files = [],
    missing = [],
    found = new Map();
  const wanted = targets.map((target) => ({
    ...target,
    hash: actorObjectHash(target.reference),
    classHash: mapBinHash(target.className),
  }));
  if (new Set(wanted.map((target) => target.hash)).size !== wanted.length)
    throw Error("Duplicate original actor object targets");
  while (pending.length) {
    const file = pending.shift().toLowerCase();
    if (visited.has(file)) continue;
    if (visited.size >= maxFiles)
      throw Error("Original actor object dependency search exceeds bounds");
    visited.add(file);
    if (!archive.has(file)) {
      missing.push(file);
      continue;
    }
    const bin = await source.bin(
      wad,
      file,
      wanted.map((target) => target.reference),
    );
    files.push(bin);
    for (const target of wanted) {
      const node = bin.tree.objects.find(
        (value) => value.pathHash === target.hash,
      );
      if (!node) continue;
      if (node.classHash !== target.classHash)
        throw Error(
          `Original actor object class mismatch: ${target.reference}`,
        );
      const previous = found.get(target.hash);
      if (previous && JSON.stringify(previous.node) !== JSON.stringify(node))
        throw Error(
          `Conflicting original actor object definitions: ${target.reference}`,
        );
      if (!previous)
        found.set(target.hash, {
          target,
          file,
          bin,
          node,
          normalized: Object.entries(bin.normalized).find(
            ([key]) => actorObjectHash(key) === target.hash,
          )?.[1],
        });
    }
    for (const dependency of bin.tree.dependencies)
      if (!visited.has(dependency.toLowerCase())) pending.push(dependency);
  }
  return {
    files,
    missing,
    found,
    unresolved: wanted.filter((target) => !found.has(target.hash)),
  };
}
