import { dirname, resolve } from "node:path";

// Capture local static module imports before constructing asynchronous workers
// or renderer bundles. The caller owns byte hashes and end-of-run drift checks.
// Browser asset imports and bare packages remain the loader's pinned resources.
export async function captureDirectSourceInputs(entrypoints, read) {
  const pending = entrypoints.map((p) => resolve(p)),
    visited = new Set(),
    scanner = new Bun.Transpiler({ loader: "js" });
  while (pending.length) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    const bytes = await read(path);
    for (const dependency of scanner.scanImports(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    )) {
      if (!dependency.path.startsWith(".")) continue;
      const target = resolve(dirname(path), dependency.path);
      if (!/\.[cm]?js$/.test(target))
        throw Error(`Untracked direct source import type: ${target}`);
      pending.push(target);
    }
  }
  return [...visited].sort();
}
