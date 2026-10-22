#!/usr/bin/env bun

/**
 * Complete the dependency bin links Bun's isolated linker can skip inside a
 * dependency cycle.
 *
 * Before linking a store entry's dependency bins, Bun waits for each dependency
 * to be extracted, except a dependency in a cycle with the entry, and it skips
 * any bin whose file does not exist yet. A cold install therefore links a
 * timing-dependent subset of the bins cycle members expose to each other (for
 * example browserslist and update-browserslist-db), so identical image builds
 * produce different production trees. Application Dockerfiles run this after
 * each production install to link every such bin: the tree Bun writes when no
 * race is lost.
 *
 * Usage: bun complete-bin-links.ts <node_modules/.bun store>
 */

import { lstat, mkdir, readdir, realpath, symlink } from "node:fs/promises";
import path from "node:path";

// Runs inside image builds before any workspace dependency is importable, so
// manifests are narrowed by hand rather than with a schema library.
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

async function sortedEntries(directory: string): Promise<string[]> {
  const names = await readdir(directory);
  return names.sort();
}

type StoreEntry = {
  readonly name: string;
  /** Package name -> store entry that provides it, for linked dependencies. */
  readonly dependencies: ReadonlyMap<string, string>;
};

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function packageNames(modules: string): Promise<string[]> {
  const names: string[] = [];
  for (const name of await sortedEntries(modules)) {
    if (name.startsWith(".")) continue;
    if (name.startsWith("@")) {
      for (const scoped of await sortedEntries(path.join(modules, name))) {
        names.push(`${name}/${scoped}`);
      }
    } else {
      names.push(name);
    }
  }
  return names;
}

async function readStore(store: string): Promise<Map<string, StoreEntry>> {
  const entries = new Map<string, StoreEntry>();
  const storeReal = await realpath(store);
  for (const name of await sortedEntries(store)) {
    // `.bun/node_modules` is the hoisted fallback directory, not an entry.
    if (name === "node_modules") continue;
    const modules = path.join(store, name, "node_modules");
    if (!(await exists(modules))) continue;
    const dependencies = new Map<string, string>();
    for (const packageName of await packageNames(modules)) {
      const target = path.relative(
        storeReal,
        await realpath(path.join(modules, packageName)),
      );
      const [entry] = target.split(path.sep);
      if (entry === undefined || entry === ".." || entry === name) continue;
      dependencies.set(packageName, entry);
    }
    entries.set(name, { name, dependencies });
  }
  return entries;
}

/** Store entries that share a dependency cycle (Tarjan's strongly connected components). */
export function cycleMembers(
  entries: ReadonlyMap<string, StoreEntry>,
): Map<string, Set<string>> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const members = new Map<string, Set<string>>();
  let next = 0;
  const visit = (name: string): void => {
    index.set(name, next);
    low.set(name, next);
    next++;
    stack.push(name);
    onStack.add(name);
    for (const dependency of entries.get(name)?.dependencies.values() ?? []) {
      if (!entries.has(dependency)) continue;
      if (!index.has(dependency)) {
        visit(dependency);
        low.set(name, Math.min(low.get(name) ?? 0, low.get(dependency) ?? 0));
      } else if (onStack.has(dependency)) {
        low.set(name, Math.min(low.get(name) ?? 0, index.get(dependency) ?? 0));
      }
    }
    if (low.get(name) !== index.get(name)) return;
    const component = new Set<string>();
    for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
      onStack.delete(member);
      component.add(member);
      if (member === name) break;
    }
    if (component.size > 1) {
      for (const member of component) members.set(member, component);
    }
  };
  for (const name of entries.keys()) if (!index.has(name)) visit(name);
  return members;
}

/** Bin name -> path inside the package, as declared by its manifest. */
export function declaredBins(
  packageName: string,
  manifest: Record<string, unknown>,
): Map<string, string> {
  const bins = new Map<string, string>();
  const bin = manifest["bin"];
  const binMap = asRecord(bin);
  if (typeof bin === "string") {
    bins.set(packageName.split("/").at(-1) ?? packageName, bin);
  } else if (binMap !== undefined) {
    for (const [name, file] of Object.entries(binMap)) {
      if (typeof file !== "string") {
        throw new TypeError(`${packageName} declares a non-string bin ${name}`);
      }
      bins.set(name, file);
    }
  } else if (bin !== undefined) {
    throw new TypeError(`${packageName} declares an unsupported bin field`);
  }
  const directories = asRecord(manifest["directories"]);
  if (directories?.["bin"] !== undefined && bins.size === 0) {
    throw new Error(`${packageName} uses directories.bin inside a cycle`);
  }
  return bins;
}

/** Link one dependency's bins into an entry's `.bin`, keeping existing links. */
async function linkMissingBins(
  modules: string,
  packageName: string,
): Promise<string[]> {
  const manifest = asRecord(
    await Bun.file(path.join(modules, packageName, "package.json")).json(),
  );
  if (manifest === undefined) {
    throw new TypeError(`${packageName} has no manifest object`);
  }
  const created: string[] = [];
  for (const [bin, file] of declaredBins(packageName, manifest)) {
    const link = path.join(modules, ".bin", bin);
    if (await exists(link)) continue;
    await mkdir(path.dirname(link), { recursive: true });
    await symlink(
      path.posix.join("..", packageName, path.posix.normalize(file)),
      link,
    );
    created.push(link);
  }
  return created;
}

export async function completeBinLinks(store: string): Promise<string[]> {
  const entries = await readStore(store);
  const created: string[] = [];
  for (const [name, cycle] of cycleMembers(entries)) {
    const modules = path.join(store, name, "node_modules");
    for (const [packageName, entry] of entries.get(name)?.dependencies ?? []) {
      if (!cycle.has(entry)) continue;
      for (const link of await linkMissingBins(modules, packageName)) {
        created.push(path.relative(store, link));
      }
    }
  }
  return created.sort();
}

if (import.meta.main) {
  const [store] = Bun.argv.slice(2);
  if (store === undefined) {
    throw new Error("usage: complete-bin-links.ts <node_modules/.bun store>");
  }
  const created = await completeBinLinks(store);
  console.log(
    `completed ${String(created.length)} cycle bin links${created.length > 0 ? `: ${created.join(" ")}` : ""}`,
  );
}
