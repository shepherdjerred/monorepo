#!/usr/bin/env bun

/**
 * Project the workspace manifests one image's filtered `bun install` needs.
 *
 * Application Dockerfiles run this in a cheap `manifests` stage that sees every
 * workspace manifest, then their install stages copy only its output. Bun
 * installs a filtered workspace from the frozen lockfile with just that
 * closure on disk, and BuildKit keys the copy on content, so an edit to a
 * package outside the closure no longer reruns the install or changes the
 * manifests shipped in the runtime image.
 *
 * The closure is the same `workspace:` walk image selection attributes (every
 * dependency field, transitively), so the install sees a superset of what each
 * filter links.
 *
 * Usage: bun workspace-manifests.ts <workspace-root> <output-root> <filter>...
 */

import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  dependencyClosure,
  loadWorkspaces,
  type WorkspacePackage,
} from "../selectors/select-image-targets-workspaces.ts";

/** Root-relative manifest paths for the closure of Bun `--filter` name globs. */
export function closureManifestPaths(
  filters: readonly string[],
  packages: ReadonlyMap<string, WorkspacePackage>,
): string[] {
  if (filters.length === 0) throw new Error("at least one filter is required");
  const closure = new Set<string>();
  for (const filter of filters) {
    const glob = new Bun.Glob(filter);
    const matches = [...packages.keys()].filter((name) => glob.match(name));
    if (matches.length === 0) {
      throw new Error(`install filter matches no workspace: ${filter}`);
    }
    for (const match of matches) {
      for (const name of dependencyClosure(match, packages)) closure.add(name);
    }
  }
  const manifests = [...closure].map((name) => {
    const workspace = packages.get(name);
    if (workspace === undefined) {
      throw new Error(`workspace disappeared while projecting: ${name}`);
    }
    return `${workspace.dir}package.json`;
  });
  return ["package.json", ...manifests.sort()];
}

export async function writeClosureManifests(
  workspaceRoot: string,
  outputRoot: string,
  filters: readonly string[],
): Promise<string[]> {
  const manifests = closureManifestPaths(
    filters,
    await loadWorkspaces(workspaceRoot),
  );
  for (const manifest of manifests) {
    const destination = path.join(outputRoot, manifest);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(workspaceRoot, manifest), destination);
  }
  return manifests;
}

if (import.meta.main) {
  const [workspaceRoot, outputRoot, ...filters] = Bun.argv.slice(2);
  if (workspaceRoot === undefined || outputRoot === undefined) {
    throw new Error(
      "usage: workspace-manifests.ts <workspace-root> <output-root> <filter>...",
    );
  }
  const manifests = await writeClosureManifests(
    workspaceRoot,
    outputRoot,
    filters,
  );
  console.log(`install closure: ${manifests.join(" ")}`);
}
