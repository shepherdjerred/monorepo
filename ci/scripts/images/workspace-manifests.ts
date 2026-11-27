#!/usr/bin/env bun

/**
 * Project the install inputs one image's filtered `bun install` needs.
 *
 * Application Dockerfiles run this in a cheap `manifests` stage that sees every
 * workspace manifest, the root `bun.lock` and `patches/`, then their install
 * stages copy only its output: the closure's workspace manifests plus a root
 * `package.json`, `bun.lock` and patch set projected onto that closure
 * (install-projection.ts). BuildKit keys the copy on content, so a manifest,
 * lockfile or patch change for a package outside the closure no longer reruns
 * the install or changes the files shipped in the runtime image.
 *
 * The closure is the same `workspace:` walk image selection attributes (every
 * dependency field, transitively), so the install sees a superset of what each
 * filter links.
 *
 * Usage: bun workspace-manifests.ts <workspace-root> <output-root> <filter>...
 */

import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { projectInstallInputs } from "./install-projection/install-projection.ts";
import { isRecord } from "../selectors/select-image-targets-lockfile.ts";
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

async function copyInto(
  workspaceRoot: string,
  outputRoot: string,
  file: string,
): Promise<void> {
  const destination = path.join(outputRoot, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(workspaceRoot, file), destination);
}

/**
 * Write the closure's workspace manifests and its projected root
 * `package.json`, `bun.lock` and patches; returns the written paths.
 */
export async function writeClosureManifests(
  workspaceRoot: string,
  outputRoot: string,
  filters: readonly string[],
): Promise<string[]> {
  const rootManifest = await Bun.file(
    path.join(workspaceRoot, "package.json"),
  ).text();
  const root: unknown = JSON.parse(rootManifest);
  const rootName = isRecord(root) ? root["name"] : undefined;
  for (const filter of filters) {
    if (typeof rootName === "string" && new Bun.Glob(filter).match(rootName)) {
      throw new Error(`install filter selects the root workspace: ${filter}`);
    }
  }
  const manifests = closureManifestPaths(
    filters,
    await loadWorkspaces(workspaceRoot),
  ).filter((manifest) => manifest !== "package.json");
  const projection = projectInstallInputs({
    rootManifest,
    lockfile: await Bun.file(path.join(workspaceRoot, "bun.lock")).text(),
    workspaceDirs: manifests.map((manifest) => path.dirname(manifest)),
  });
  for (const manifest of manifests) {
    await copyInto(workspaceRoot, outputRoot, manifest);
  }
  for (const patch of projection.patches) {
    await copyInto(workspaceRoot, outputRoot, patch);
  }
  await Bun.write(path.join(outputRoot, "package.json"), projection.manifest);
  await Bun.write(path.join(outputRoot, "bun.lock"), projection.lockfile);
  return ["package.json", "bun.lock", ...projection.patches, ...manifests];
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
