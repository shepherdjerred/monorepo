#!/usr/bin/env bun
/**
 * Assert every root patchedDependencies entry is ALIVE: its "name@version"
 * key must resolve in bun.lock, its patch file must exist, and no orphan
 * patch files may exist (root patches/ or package-local bun-style patches).
 *
 * Bun applies a patch only when the resolved version exactly matches the
 * key, so a routine dependency bump silently un-applies the patch with no
 * warning — which is how the twisted@1.73.0 (ZAAHEN champion) and
 * satori@0.18.3 patches died unnoticed for weeks. This check makes that
 * bump loudly fail until the patch is regenerated for the new version or
 * deliberately deleted.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Slice the top-level "packages" object out of bun.lock. A raw substring
 * search over the WHOLE lock is wrong here: bun.lock echoes the manifest's
 * patchedDependencies section verbatim, so a stale key would self-match its
 * own echo and the liveness check would never fire — the exact false
 * negative this script exists to prevent. Brace-matching is string-aware so
 * braces inside quoted values cannot desync it.
 */
export function packagesSection(lockText: string): string {
  const marker = '"packages": {';
  const start = lockText.indexOf(marker);
  if (start === -1) {
    throw new Error('bun.lock has no top-level "packages" section');
  }
  let depth = 0;
  let inString = false;
  for (let i = start + marker.length - 1; i < lockText.length; i++) {
    const c = lockText[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") {
      depth++;
      continue;
    }
    if (c !== "}") continue;
    depth--;
    if (depth === 0) return lockText.slice(start, i + 1);
  }
  throw new Error('bun.lock "packages" section is unterminated');
}

/**
 * Resolved registry versions per package name, read from the package-entry
 * ids (`["name@version", …]`) inside the packages section. Workspace-member
 * entries (`name@workspace:dir`) are skipped.
 */
export function resolvedVersionsByName(
  lockText: string,
): Map<string, Set<string>> {
  const section = packagesSection(lockText);
  const byName = new Map<string, Set<string>>();
  for (const match of section.matchAll(/\["([^"]+)"/g)) {
    const id = match[1] ?? "";
    const at = id.lastIndexOf("@");
    if (at <= 0) continue;
    const name = id.slice(0, at);
    const version = id.slice(at + 1);
    if (version.startsWith("workspace:")) continue;
    const versions = byName.get(name) ?? new Set<string>();
    versions.add(version);
    byName.set(name, versions);
  }
  return byName;
}

export function readPatchedDependencies(
  manifestText: string,
): Record<string, string> {
  const manifestRaw: unknown = JSON.parse(manifestText);
  if (typeof manifestRaw !== "object" || manifestRaw === null) {
    throw new Error("root package.json must contain an object");
  }
  const patchedRaw: unknown = Reflect.get(manifestRaw, "patchedDependencies");
  const patched: Record<string, string> = {};
  if (patchedRaw === undefined) return patched;
  if (typeof patchedRaw !== "object" || patchedRaw === null) {
    throw new Error("patchedDependencies must be an object");
  }
  for (const [key, value] of Object.entries(patchedRaw)) {
    if (typeof value !== "string") {
      throw new TypeError(`patchedDependencies[${key}] must be a string path`);
    }
    patched[key] = value;
  }
  return patched;
}

function splitKey(key: string): { name: string; version: string } {
  const at = key.lastIndexOf("@");
  return { name: key.slice(0, at), version: key.slice(at + 1) };
}

async function keyErrors(
  root: string,
  patched: Record<string, string>,
  resolved: Map<string, Set<string>>,
): Promise<string[]> {
  const errors: string[] = [];
  for (const [key, patchPath] of Object.entries(patched)) {
    const { name, version } = splitKey(key);
    if (!(resolved.get(name)?.has(version) ?? false)) {
      errors.push(
        `patchedDependencies key "${key}" matches NO resolved package in bun.lock — ` +
          `the patch is silently NOT applied. Regenerate it for the currently ` +
          `resolved version (bun patch <name>) or delete the entry + file.`,
      );
    }
    if (!(await Bun.file(`${root}/${patchPath}`).exists())) {
      errors.push(
        `patchedDependencies key "${key}" points at missing file ${patchPath}.`,
      );
    }
  }
  return errors;
}

// Unpatched resolutions: bun patches only exactly-keyed versions, so any
// resolved version of a patched package that no key covers ships unpatched
// to its consumers. Keys may legitimately cover SEVERAL versions of one
// package — coverage is judged against all of them, not key-by-key.
function coverageErrors(
  patched: Record<string, string>,
  resolved: Map<string, Set<string>>,
): string[] {
  const patchedVersionsByName = new Map<string, Set<string>>();
  for (const key of Object.keys(patched)) {
    const { name, version } = splitKey(key);
    const versions = patchedVersionsByName.get(name) ?? new Set<string>();
    versions.add(version);
    patchedVersionsByName.set(name, versions);
  }
  const errors: string[] = [];
  for (const [name, patchedVersions] of patchedVersionsByName) {
    const uncovered = [...(resolved.get(name) ?? new Set<string>())]
      .filter((v) => !patchedVersions.has(v))
      .sort();
    if (uncovered.length > 0) {
      errors.push(
        `"${name}" also resolves at unpatched version(s) ${uncovered.join(", ")} — ` +
          `no patchedDependencies key covers those instances. Align the ` +
          `resolutions or patch each resolved version.`,
      );
    }
  }
  return errors;
}

async function rootOrphanErrors(
  root: string,
  referenced: ReadonlySet<string>,
): Promise<string[]> {
  // A repo with zero patched deps validly has no patches/ dir at all.
  let files: string[] = [];
  try {
    files = await readdir(`${root}/patches`);
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }
  return files
    .filter((file) => file.endsWith(".patch"))
    .filter((file) => !referenced.has(`patches/${file}`))
    .map(
      (file) =>
        `patches/${file} is not referenced by any patchedDependencies entry — ` +
        `dead file; delete it or add the manifest entry.`,
    );
}

// Package-local bun-style dep patches can NEVER apply: bun honors
// patchedDependencies only in the workspace-root manifest. Any
// `<name>@<version>.patch` under packages/**/patches/ is a dead relic of
// the pre-consolidation per-package workspaces (build-input patch dirs
// like talos machine configs or wasm-src use non-versioned filenames and
// are untouched by this).
const generatedDirectoryNames = new Set([
  ".astro",
  ".cache",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

async function packagePatchFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string, relative: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (generatedDirectoryNames.has(entry.name)) continue;

      const childDirectory = path.join(directory, entry.name);
      const childRelative = `${relative}/${entry.name}`;
      if (entry.name !== "patches") {
        await visit(childDirectory, childRelative);
        continue;
      }

      const patchEntries = await readdir(childDirectory, {
        withFileTypes: true,
      });
      for (const patchEntry of patchEntries) {
        if (patchEntry.isFile() && patchEntry.name.endsWith(".patch")) {
          files.push(`${childRelative}/${patchEntry.name}`);
        }
      }
    }
  }

  await visit(path.join(root, "packages"), "packages");
  return files;
}

async function packageLocalOrphanErrors(root: string): Promise<string[]> {
  const bunStylePatch = /^[@%\w.-]+@\d[\w.-]*\.patch$/;
  const errors: string[] = [];
  for (const rel of await packagePatchFiles(root)) {
    const file = rel.split("/").pop() ?? "";
    if (bunStylePatch.test(file)) {
      errors.push(
        `${rel} is a bun-style dependency patch outside the root patches/ dir — ` +
          `bun never applies it (patchedDependencies is root-only); delete it ` +
          `or move the fix to the root manifest.`,
      );
    }
  }
  return errors;
}

export async function collectErrors(root: string): Promise<string[]> {
  const patched = readPatchedDependencies(
    await Bun.file(`${root}/package.json`).text(),
  );
  const resolved = resolvedVersionsByName(
    await Bun.file(`${root}/bun.lock`).text(),
  );
  return [
    ...(await keyErrors(root, patched, resolved)),
    ...coverageErrors(patched, resolved),
    ...(await rootOrphanErrors(root, new Set(Object.values(patched)))),
    ...(await packageLocalOrphanErrors(root)),
  ];
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname;
  const errors = await collectErrors(root);
  if (errors.length > 0) {
    console.error("check-patched-deps: FAIL");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const count = Object.keys(
    readPatchedDependencies(await Bun.file(`${root}/package.json`).text()),
  ).length;
  console.log(
    `check-patched-deps: ${String(count)} patched dependencies, all alive`,
  );
}
