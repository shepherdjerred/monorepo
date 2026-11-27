/**
 * Root-manifest attribution for image selection: how a package.json or
 * scripts/package.json change reaches images. Like the selector, this is
 * dependency-free and must run under `bun --no-install` before any workspace
 * install.
 *
 * This file shapes image selection, so it is listed in GLOBAL_IMAGE_INPUTS —
 * a change here rebuilds every image (fail-safe).
 */

import { isRecord } from "./select-image-targets-lockfile.ts";
import type { FilePair } from "./select-image-targets-lockfile.ts";
import {
  targetClosureDirs,
  targetInstallClosureDirs,
} from "./select-image-targets-workspaces.ts";
import type { WorkspacePackage } from "./select-image-targets-workspaces.ts";
import { IMAGE_TARGET_OWNERS } from "../images/image-targets.ts";

// Top-level root-manifest keys whose changes are NOT global: repo tooling
// (devDependencies: turbo, prettier, knip, …) and script text ship in no
// image. Everything else — overrides, patchedDependencies,
// trustedDependencies, packageManager — shapes resolution or install behavior
// for every image and stays global. `workspaces` is attributable only when
// entries are purely added (see workspaceAdditions).
const MANIFEST_ATTRIBUTABLE_KEYS = new Set(["devDependencies", "scripts"]);

const SCRIPTS_MANIFEST = "scripts/package.json";

/**
 * Every manifest an application image's manifests stage copies into
 * /workspace. workspace-manifests.ts loads every root workspace's manifest
 * there, so a workspace these globs miss breaks every application image's
 * install projection. select-image-targets-dockerfiles.test.ts pins each
 * Dockerfile and every root workspace to this list.
 */
export const MANIFESTS_STAGE_SOURCES: readonly string[] = [
  "package.json",
  "scripts/package.json",
  "packages/*/package.json",
  "packages/*/packages/*/package.json",
  "packages/docs/wiki/package.json",
  "packages/homelab/src/cdk8s/package.json",
  "packages/homelab/src/helm-types/package.json",
];

export function manifestsStageCopies(workspaceDir: string): boolean {
  const manifest = `${workspaceDir.replace(/\/$/, "")}/package.json`;
  return MANIFESTS_STAGE_SOURCES.some((source) =>
    new Bun.Glob(source).match(manifest),
  );
}

/**
 * How a root-manifest change reaches images: `global` selects every image;
 * otherwise the change is attributable and `addedWorkspaces` lists its new
 * `workspaces` entries.
 */
export type ManifestChange =
  | { readonly global: true }
  | { readonly global: false; readonly addedWorkspaces: readonly string[] };

const GLOBAL_MANIFEST_CHANGE: ManifestChange = { global: true };

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
    ? value
    : null;
}

/**
 * New `workspaces` entries, or null unless head is base plus insertions.
 * Each image install projects the root manifest but finds only its closure's
 * workspace directories on disk, so a new workspace changes no install
 * outside the closures that depend on it. A removal or reorder stays global.
 */
function workspaceAdditions(base: unknown, head: unknown): string[] | null {
  const before = stringArray(base);
  const after = stringArray(head);
  if (before === null || after === null) return null;
  if (new Set(after).size !== after.length) return null;
  const existing = new Set(before);
  const kept = after.filter((entry) => existing.has(entry));
  return JSON.stringify(kept) === JSON.stringify(before)
    ? after.filter((entry) => !existing.has(entry))
    : null;
}

function parsedPair(
  pair: FilePair,
): { base: Record<string, unknown>; head: Record<string, unknown> } | null {
  if (pair.base === null) return null;
  try {
    const base: unknown = JSON.parse(pair.base);
    const head: unknown = JSON.parse(pair.head);
    return isRecord(base) && isRecord(head) ? { base, head } : null;
  } catch {
    return null;
  }
}

/**
 * Classify a root-manifest change. Allowlist, not blocklist: the change skips
 * the global trigger ONLY if every differing top-level key is in
 * MANIFEST_ATTRIBUTABLE_KEYS or is a pure `workspaces` addition. Parse
 * failure, an unreadable base, or any other differing key → global (fail
 * open).
 */
export function classifyManifestChange(pair: FilePair): ManifestChange {
  const parsed = parsedPair(pair);
  if (parsed === null) return GLOBAL_MANIFEST_CHANGE;
  const { base, head } = parsed;
  let added: string[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
    const same =
      JSON.stringify(base[key] ?? null) === JSON.stringify(head[key] ?? null);
    if (same || MANIFEST_ATTRIBUTABLE_KEYS.has(key)) continue;
    const workspaces =
      key === "workspaces" ? workspaceAdditions(base[key], head[key]) : null;
    if (workspaces === null) return GLOBAL_MANIFEST_CHANGE;
    added = workspaces;
  }
  return { global: false, addedWorkspaces: added };
}

export type RootManifestChange =
  | { readonly globalReason: string }
  | {
      readonly globalReason: null;
      readonly addedWorkspaces: readonly string[];
    };

/**
 * The root manifest is projected into every application install, so it is
 * global unless the delta is confined to attributable keys: repo tooling, or
 * new workspaces (which reach only the closures that depend on them). The
 * accompanying bun.lock change — if any — is attributed by the closure
 * fingerprints. A missing pair fails open.
 */
export function rootManifestChange(
  changedPaths: readonly string[],
  pair: FilePair | undefined,
): RootManifestChange {
  if (!changedPaths.includes("package.json")) {
    return { globalReason: null, addedWorkspaces: [] };
  }
  if (pair === undefined) {
    return {
      globalReason:
        "package.json changed but base/head contents were unavailable (fail-open)",
    };
  }
  const change = classifyManifestChange(pair);
  if (change.global) {
    return {
      globalReason:
        "package.json changed outside attributable keys (devDependencies/scripts/added workspaces)",
    };
  }
  // Every application image's manifests stage must copy a new workspace's
  // manifest; one it misses breaks all of them, so all of them must build.
  const uncopied = change.addedWorkspaces.find(
    (dir) => !manifestsStageCopies(dir),
  );
  return uncopied === undefined
    ? { globalReason: null, addedWorkspaces: change.addedWorkspaces }
    : {
        globalReason: `package.json adds workspace ${uncopied}, whose manifest no application manifests stage copies`,
      };
}

type ManifestReason = { readonly target: string; readonly reason: string };

function addedWorkspaceReasons(
  addedWorkspaces: readonly string[],
  packages: ReadonlyMap<string, WorkspacePackage>,
): ManifestReason[] {
  return addedWorkspaces.flatMap((added) => {
    const dir = added.replace(/\/$/, "");
    return Object.entries(IMAGE_TARGET_OWNERS)
      .filter(([target, owner]) =>
        targetClosureDirs(target, owner, packages).includes(dir),
      )
      .map(([target]) => ({
        target,
        reason: `new workspace in package.json: ${dir}`,
      }));
  });
}

/**
 * scripts/ is no image workspace, but its manifest is projected into the
 * install of every closure that depends on it. A non-tooling change, or one
 * whose contents are unavailable, selects exactly those images.
 */
function scriptsManifestReasons(
  changedPaths: readonly string[],
  packages: ReadonlyMap<string, WorkspacePackage>,
  pair: FilePair | undefined,
): ManifestReason[] {
  if (!changedPaths.includes(SCRIPTS_MANIFEST)) return [];
  if (pair !== undefined && !classifyManifestChange(pair).global) return [];
  const dir = SCRIPTS_MANIFEST.slice(0, -"/package.json".length);
  return Object.entries(IMAGE_TARGET_OWNERS)
    .filter(([target, owner]) =>
      targetInstallClosureDirs(target, owner, packages).includes(dir),
    )
    .map(([target]) => ({
      target,
      reason: `install closure manifest: ${SCRIPTS_MANIFEST} outside devDependencies/scripts`,
    }));
}

/** Per-target reasons for attributable root and scripts manifest changes. */
export function manifestReasons(options: {
  readonly changedPaths: readonly string[];
  readonly packages: ReadonlyMap<string, WorkspacePackage>;
  readonly addedWorkspaces: readonly string[];
  readonly scriptsManifest: FilePair | undefined;
}): ManifestReason[] {
  const { changedPaths, packages, addedWorkspaces, scriptsManifest } = options;
  return [
    ...addedWorkspaceReasons(addedWorkspaces, packages),
    ...scriptsManifestReasons(changedPaths, packages, scriptsManifest),
  ];
}
