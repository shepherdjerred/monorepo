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
  arcade: ["@arcade/frontend", "@shepherdjerred/arcade"],
  "tasknotes-server": ["@shepherdjerred/tasknotes-web"],
  "temporal-worker": ["@shepherdjerred/toolkit"],
};

// Repository tooling is installed in the build stage but is not copied into
// any production image. Keep it out of image closure attribution even when a
// runtime workspace lists a tooling helper as a development dependency.
const NON_IMAGE_WORKSPACE_DIRS = new Set(["scripts/"]);

// ops-model reaches these images only as a manifest in their install closure:
// their Dockerfiles copy none of its source, so its catalog data
// (services.json, the catalog document) cannot change their contents.
const OPS_MODEL_MANIFEST_ONLY = {
  "packages/ops-model": ["packages/ops-model/package.json"],
} as const;

// Some images copy only shared contracts from a workspace. Dependency fingerprints
// still use the entire closure; source selection follows the copied files.
// select-image-targets-dockerfiles.test.ts fails if a Dockerfile copies a file
// these lists leave out.
export const PARTIAL_WORKSPACE_SOURCE_INPUTS: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  arcade: OPS_MODEL_MANIFEST_ONLY,
  birmel: OPS_MODEL_MANIFEST_ONLY,
  "scout-for-lol": OPS_MODEL_MANIFEST_ONLY,
  "storm-brain": OPS_MODEL_MANIFEST_ONLY,
  streambot: OPS_MODEL_MANIFEST_ONLY,
  "storm-forum": {
    "packages/ops-model": [
      "packages/ops-model/package.json",
      "packages/ops-model/src/",
    ],
    "packages/the-storm": [
      "packages/the-storm/package.json",
      "packages/the-storm/public-status.json",
    ],
  },
  "temporal-worker": {
    "packages/the-storm": [
      "packages/the-storm/package.json",
      "packages/the-storm/maintenance-status.json",
      "packages/the-storm/promotion/",
      "packages/the-storm/server/owned/plugins/TheStorm/plot-reconcile.json",
      "packages/the-storm/server/owned/plugins/TheStorm/rwf-archive.json",
    ],
    "packages/homelab": [
      "packages/homelab/package.json",
      "packages/homelab/src/domain-registry.ts",
      "packages/homelab/src/domain-registry.json",
      "packages/homelab/scripts/**/*.ts",
      "packages/homelab/src/application-release-contract.ts",
      "packages/homelab/src/delivery-*.ts",
      "packages/homelab/src/static-site-delivery-ownership.ts",
      "packages/homelab/src/minecraft-delivery-receipt.schema.json",
      "packages/homelab/src/cdk8s/scripts/delivery/worker-pool-template.ts",
      "packages/homelab/src/cdk8s/scripts/onepassword/audit-consumption.ts",
      "packages/homelab/src/cdk8s/src/argocd-application-readiness.ts",
      "packages/homelab/src/cdk8s/src/scout-release-budgets.ts",
      "packages/homelab/src/cdk8s/src/temporal-release-budgets.ts",
    ],
  },
};

export const pathMatchesPrefix = (path: string, prefix: string): boolean =>
  prefix.includes("*")
    ? new Bun.Glob(prefix).match(path)
    : prefix.endsWith("/")
      ? path.startsWith(prefix)
      : path === prefix;

function workspaceSourceMatches(
  target: string,
  dir: string,
  path: string,
): boolean {
  const inputs = PARTIAL_WORKSPACE_SOURCE_INPUTS[target]?.[dir] ?? [`${dir}/`];
  return inputs.some((prefix) => pathMatchesPrefix(path, prefix));
}

export function workspaceSourceChanges(
  changedPaths: readonly string[],
  owners: Readonly<Record<string, string>>,
  packages: ReadonlyMap<string, WorkspacePackage>,
): { target: string; path: string; dir: string }[] {
  const changes = [];
  for (const [target, owner] of Object.entries(owners)) {
    const dirs = targetClosureDirs(target, owner, packages);
    for (const path of changedPaths) {
      const dir = dirs.find((candidate) =>
        workspaceSourceMatches(target, candidate, path),
      );
      if (dir !== undefined) changes.push({ target, path, dir });
    }
  }
  return changes;
}

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
  return targetInstallClosureDirs(target, owner, packages).filter(
    (dir) => !NON_IMAGE_WORKSPACE_DIRS.has(`${dir}/`),
  );
}

/**
 * Every workspace dir in the target's install closure, including repository
 * tooling whose manifest the install projects but whose source no image
 * copies.
 */
export function targetInstallClosureDirs(
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
