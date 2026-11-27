/**
 * Project the root install inputs (`package.json` and `bun.lock`) onto one
 * image's workspace closure.
 *
 * Every application image installs a filtered workspace from the frozen
 * lockfile. Copying the full root files keyed that install on every
 * dependency in the monorepo, so a lockfile edit for any package reran every
 * image's install. The projection keeps only what the closure's install
 * reads: the closure's workspace entries, the packages Bun keeps for them
 * (the dependency graph without optional peers, which Bun never installs on
 * their own), and the overrides and patches that apply to those packages.
 * Kept entries are copied verbatim and printed in Bun's own lockfile layout:
 * `printLockfile` reproduces a parsed `bun.lock` byte for byte.
 *
 * A frozen install re-resolves nothing from the projection, and Bun's own
 * `--lockfile-only` rewrite of a projection installs the identical set.
 * `--frozen-lockfile` acceptance proves only that the projection is
 * sufficient; it also accepts extra entries such as a kept optional peer.
 * Exactness is check-install-projection.ts `drift`: it compares each image's
 * install against the full lockfile, which also links optional peers that
 * only other workspaces install, and fails on any change that is neither an
 * audited optional peer nor allowlisted.
 *
 * Like the selector modules it reuses, this is dependency-free: the image
 * `manifests` stage runs it before any install.
 */

import {
  closurePackageKeys,
  isRecord,
  parseJsonc,
  parseLockfile,
} from "../../selectors/select-image-targets-lockfile.ts";

export type InstallProjection = {
  /** The projected root `package.json`. */
  readonly manifest: string;
  /** The projected `bun.lock`. */
  readonly lockfile: string;
  /** Root-relative patch files the projected manifest references. */
  readonly patches: readonly string[];
};

// Top-level bun.lock keys the projection understands. A new key means the
// lockfile format moved; fail loudly rather than guess what it scopes.
const LOCKFILE_KEYS = new Set([
  "lockfileVersion",
  "configVersion",
  "workspaces",
  "trustedDependencies",
  "patchedDependencies",
  "overrides",
  "catalog",
  "catalogs",
  "packages",
]);

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

// Root scripts Bun runs during an install. Every other root script is
// repository tooling the install never reads.
const INSTALL_LIFECYCLE_SCRIPTS = new Set([
  "preinstall",
  "install",
  "postinstall",
  "preprepare",
  "prepare",
  "postprepare",
]);

// Bun prints a package's multi-value platform constraints with padding and a
// trailing comma (`[ "linux", "win32", ]`), unlike its other inline arrays.
const PLATFORM_KEYS = new Set(["os", "cpu", "libc"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function packageId(value: unknown, key: string): string {
  if (!Array.isArray(value) || typeof value[0] !== "string") {
    throw new TypeError(`lockfile package ${key} has an unexpected shape`);
  }
  return value[0];
}

/** The package name at the end of a (possibly nested) lockfile key. */
function keyName(key: string): string {
  const scoped = /(@[^/]+\/[^/]+)$/.exec(key);
  return scoped?.[1] ?? key.slice(key.lastIndexOf("/") + 1);
}

/** The registry name of a resolved `name@version` id. */
function idName(id: string): string {
  return id.slice(0, id.lastIndexOf("@"));
}

function pick(
  source: Record<string, unknown>,
  keep: (key: string) => boolean,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => keep(key)),
  );
}

/** Copy `source` in order, replacing keys or (for undefined) dropping them. */
function withKeys(
  source: Record<string, unknown>,
  replacements: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const next = key in replacements ? replacements[key] : value;
    if (next !== undefined) result[key] = next;
  }
  return result;
}

/** A pruned map, or undefined (drop the key) once nothing in it applies. */
function prunedMap(
  value: unknown,
  label: string,
  keep: (key: string) => boolean,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const kept = pick(record(value, label), keep);
  return Object.keys(kept).length === 0 ? undefined : kept;
}

const withoutDependencies = Object.fromEntries(
  DEPENDENCY_FIELDS.map((field) => [field, undefined]),
);

function inline(value: unknown, key = ""): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => inline(item));
    return PLATFORM_KEYS.has(key)
      ? `[ ${items.map((item) => `${item}, `).join("")}]`
      : `[${items.join(", ")}]`;
  }
  const entries = Object.entries(record(value, "lockfile value"));
  if (entries.length === 0) return "{}";
  const members = entries.map(
    ([name, item]) => `${JSON.stringify(name)}: ${inline(item, name)}`,
  );
  return `{ ${members.join(", ")} }`;
}

function block(value: unknown, indent: string): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    const items = value.map((item) => `${inner}${block(item, inner)},\n`);
    return `[\n${items.join("")}${indent}]`;
  }
  if (!isRecord(value)) return inline(value);
  const members = Object.entries(value).map(
    ([key, item]) => `${inner}${JSON.stringify(key)}: ${block(item, inner)},\n`,
  );
  return `{\n${members.join("")}${indent}}`;
}

/** Print a lockfile object in the layout `bun install` writes. */
export function printLockfile(lock: Record<string, unknown>): string {
  const members = Object.entries(lock).map(([key, value]) => {
    if (key !== "packages") {
      return `  ${JSON.stringify(key)}: ${block(value, "  ")}`;
    }
    const entries = Object.entries(record(value, "lockfile packages")).map(
      ([name, entry]) => `    ${JSON.stringify(name)}: ${inline(entry)}`,
    );
    return `  "packages": {\n${entries.join(",\n\n")},\n  }`;
  });
  return `{\n${members.join(",\n")}\n}\n`;
}

/** The lockfile package keys a projection onto `dirs` keeps. */
function keptPackageKeys(
  lockfile: string,
  packages: Record<string, unknown>,
  dirs: ReadonlySet<string>,
): Set<string> {
  const reached = closurePackageKeys([...dirs], parseLockfile(lockfile));
  if (reached === null) {
    throw new Error("a closure workspace is missing from bun.lock");
  }
  const keep = new Set<string>();
  for (const [key, value] of Object.entries(packages)) {
    const workspace = /@workspace:(.+)$/.exec(packageId(value, key))?.[1];
    // A workspace is kept only when it belongs to the closure; a registry
    // package's peer link to another workspace is skipped, as Bun skips it
    // when that workspace is absent from disk.
    if (workspace === undefined ? reached.has(key) : dirs.has(workspace)) {
      keep.add(key);
    }
  }
  return keep;
}

/**
 * Project the root manifest and lockfile onto the given workspace dirs (no
 * trailing slash, as `bun.lock` keys them). The root workspace's own
 * dependencies are repository tooling a filtered install never links, so the
 * projection drops them; callers must not select the root workspace.
 */
export function projectInstallInputs(input: {
  readonly rootManifest: string;
  readonly lockfile: string;
  readonly workspaceDirs: readonly string[];
}): InstallProjection {
  const raw = record(parseJsonc(input.lockfile), "bun.lock");
  for (const key of Object.keys(raw)) {
    if (!LOCKFILE_KEYS.has(key)) {
      throw new Error(`unknown lockfile key: ${key}`);
    }
  }
  const workspaces = record(raw["workspaces"], "lockfile workspaces");
  const packages = record(raw["packages"], "lockfile packages");
  const dirs = new Set(input.workspaceDirs);
  for (const dir of dirs) {
    if (dir === "" || !(dir in workspaces)) {
      throw new Error(`not an installable lockfile workspace: ${dir}`);
    }
  }

  const keep = keptPackageKeys(input.lockfile, packages, dirs);
  const keptPackages = pick(packages, (key) => keep.has(key));
  const ids = new Set(
    Object.entries(keptPackages).map(([key, value]) => packageId(value, key)),
  );
  // Overrides name a dependency; keep one when its name is installed under
  // either its key (an alias) or its registry name.
  const names = new Set([
    ...[...keep].map((key) => keyName(key)),
    ...[...ids].map((id) => idName(id)),
  ]);
  const keepOverride = (name: string): boolean => names.has(name);
  // Patches are keyed by the exact `name@version` they apply to.
  const keepPatch = (key: string): boolean => ids.has(key);

  const lockfile = printLockfile(
    withKeys(raw, {
      workspaces: {
        "": withKeys(
          record(workspaces[""], "lockfile root workspace"),
          withoutDependencies,
        ),
        ...pick(workspaces, (dir) => dirs.has(dir)),
      },
      overrides: prunedMap(raw["overrides"], "overrides", keepOverride),
      patchedDependencies: prunedMap(
        raw["patchedDependencies"],
        "patchedDependencies",
        keepPatch,
      ),
      packages: keptPackages,
    }),
  );

  const root = record(JSON.parse(input.rootManifest), "root package.json");
  const declared = root["workspaces"];
  if (!Array.isArray(declared)) {
    throw new TypeError("root package.json workspaces must be an array");
  }
  const patchedDependencies = prunedMap(
    root["patchedDependencies"],
    "root patchedDependencies",
    keepPatch,
  );
  const manifest = withKeys(root, {
    ...withoutDependencies,
    scripts: prunedMap(root["scripts"], "root scripts", (name) =>
      INSTALL_LIFECYCLE_SCRIPTS.has(name),
    ),
    workspaces: declared.filter(
      (dir) => typeof dir === "string" && dirs.has(dir),
    ),
    overrides: prunedMap(root["overrides"], "root overrides", keepOverride),
    patchedDependencies,
  });
  const patches = Object.values(patchedDependencies ?? {}).map((file) => {
    if (typeof file !== "string") {
      throw new TypeError("patchedDependencies values must be paths");
    }
    return file;
  });
  return {
    manifest: `${JSON.stringify(manifest, null, 2)}\n`,
    lockfile,
    patches: patches.sort(),
  };
}
