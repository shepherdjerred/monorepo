import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import path from "node:path";

const comparison = (value) =>
  process.platform === "win32" ? value.toLowerCase() : value;
const contains = (parent, child) => {
  const left = comparison(parent),
    right = comparison(child);
  return (
    left === right ||
    right.startsWith(left.endsWith(path.sep) ? left : left + path.sep)
  );
};
async function canonicalDestination(input) {
  let candidate = path.resolve(input);
  const suffix = [];
  for (;;) {
    try {
      return path.join(await realpath(candidate), ...suffix);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      suffix.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}
function disjoint(source, output) {
  if (contains(source, output) || contains(output, source))
    throw Error(
      "Approved source and output caches must be canonically disjoint",
    );
}

// Every invocation gets an empty private namespace. A failed run has no final
// manifest; later invocations neither inventory nor overwrite its files.
export async function createStaticPreparationOutput(
  sourceCacheArg,
  outputCacheArg,
  { prefix, directory },
) {
  if (!/^[a-z\d-]+-$/.test(prefix) || !/^[a-z\d-]+$/.test(directory))
    throw Error("Bounded static preparation labels required");
  const sourceCache = await realpath(path.resolve(sourceCacheArg));
  let cache = await canonicalDestination(outputCacheArg);
  disjoint(sourceCache, cache);
  await mkdir(cache, { recursive: true });
  cache = await realpath(cache);
  disjoint(sourceCache, cache);
  const prepared = await canonicalDestination(path.join(cache, "prepared"));
  if (!contains(cache, prepared))
    throw Error("Prepared namespace escaped its output cache");
  await mkdir(prepared, { recursive: true });
  const runRoot = await realpath(await mkdtemp(path.join(prepared, prefix)));
  if (!contains(cache, runRoot))
    throw Error("Prepared run escaped its output cache");
  disjoint(sourceCache, runRoot);
  const out = path.join(runRoot, "public", directory);
  const work = path.join(runRoot, "research", directory);
  await mkdir(out, { recursive: true });
  await mkdir(work, { recursive: true });
  return { sourceCache, cache, runRoot, out, work };
}

export function createMapSceneOutput(sourceCacheArg, outputCacheArg) {
  return createStaticPreparationOutput(sourceCacheArg, outputCacheArg, {
    prefix: "map11-",
    directory: "map11-scene",
  });
}
