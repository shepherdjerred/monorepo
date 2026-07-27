/**
 * Workspace-graph machinery for image selection: load the bun workspace
 * manifests and walk `workspace:*` dependency closures (plus the
 * embedded-artifact extra owners) into the directory sets each image target
 * owns. Split from select-image-targets.ts to keep both files scannable;
 * like the selector, this is dependency-free and must run under
 * `bun --no-install` before any workspace install.
 *
 * This file shapes image selection, so it is listed in GLOBAL_IMAGE_INPUTS —
 * a change here rebuilds every image (fail-safe).
 */

import { isRecord } from "./select-image-targets-lockfile.ts";

export type WorkspacePackage = {
  readonly dir: string;
  readonly workspaceDependencies: readonly string[];
};

// Extra workspace owners whose dependency closures are BAKED into an image
// beyond the primary owner's runtime closure: temporal embeds the compiled
// toolkit CLI, and the game images bake their frontend's vite build. Their
// resolved deps must join the target's lockfile/patch attribution — a
// toolkit-only or frontend-only dep bump changes the embedded artifact even
// though no file under the target's source prefixes changed.
const TARGET_EXTRA_OWNERS: Readonly<Record<string, readonly string[]>> = {
  "temporal-worker": ["@shepherdjerred/toolkit"],
  "discord-plays-pokemon": ["@discord-plays-pokemon/frontend"],
  "discord-plays-mario-kart": ["@discord-plays-mario-kart/frontend"],
};

function stringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

function workspaceDependencyNames(raw: Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencies = raw[field];
    if (dependencies === undefined) {
      continue;
    }
    if (!isRecord(dependencies)) {
      throw new Error(`${field} must be an object`);
    }
    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version === "string" && version.startsWith("workspace:")) {
        names.add(name);
      }
    }
  }
  return [...names];
}

export async function loadWorkspaces(
  repoRoot: string,
): Promise<Map<string, WorkspacePackage>> {
  const rootRaw: unknown = JSON.parse(
    await Bun.file(`${repoRoot}/package.json`).text(),
  );
  if (!isRecord(rootRaw)) {
    throw new Error("root package.json must contain an object");
  }
  const workspaceDirs = stringArray(rootRaw["workspaces"], "workspaces");
  const packages = new Map<string, WorkspacePackage>();
  for (const dir of workspaceDirs) {
    const raw: unknown = JSON.parse(
      await Bun.file(`${repoRoot}/${dir}/package.json`).text(),
    );
    if (!isRecord(raw) || typeof raw["name"] !== "string") {
      throw new Error(`${dir}/package.json must contain a string name`);
    }
    packages.set(raw["name"], {
      dir: `${dir}/`,
      workspaceDependencies: workspaceDependencyNames(raw),
    });
  }
  return packages;
}

export function dependencyClosure(
  owner: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
): Set<string> {
  const closure = new Set<string>();
  const pending = [owner];
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || closure.has(name)) {
      continue;
    }
    const pkg = packages.get(name);
    if (pkg === undefined) {
      throw new Error(`image owner workspace does not exist: ${name}`);
    }
    closure.add(name);
    pending.push(...pkg.workspaceDependencies);
  }
  return closure;
}

/**
 * Workspace dirs whose resolved dependencies shape the target's image: the
 * primary owner's closure plus any TARGET_EXTRA_OWNERS closures (embedded
 * artifacts like the compiled toolkit CLI and baked frontend builds).
 */
export function targetClosureDirs(
  target: string,
  owner: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
): string[] {
  const names = dependencyClosure(owner, packages);
  for (const extra of TARGET_EXTRA_OWNERS[target] ?? []) {
    for (const name of dependencyClosure(extra, packages)) {
      names.add(name);
    }
  }
  return [...names].map((name) => {
    const pkg = packages.get(name);
    if (pkg === undefined) {
      throw new Error(`workspace disappeared while selecting images: ${name}`);
    }
    return pkg.dir.replace(/\/$/, "");
  });
}
