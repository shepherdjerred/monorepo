/**
 * Lockfile, root-manifest, and patch attribution machinery for image
 * selection: JSONC/bun.lock parsing, per-closure resolution fingerprints, and
 * the content-aware manifest classifier. Split from select-image-targets.ts
 * (which re-exports the public pieces) to keep both files scannable; like the
 * selector, this is dependency-free and must run under `bun --no-install`
 * before any workspace install.
 *
 * This file shapes image selection, so it is listed in GLOBAL_IMAGE_INPUTS —
 * a change here rebuilds every image (fail-safe).
 */

// Top-level root-manifest keys whose changes are NOT global: repo tooling
// (devDependencies: turbo, prettier, knip, …) and script text ship in no
// image. Everything else — workspaces, overrides, patchedDependencies,
// trustedDependencies, packageManager — shapes resolution or install behavior
// for every image and stays global.
const MANIFEST_ATTRIBUTABLE_KEYS = new Set(["devDependencies", "scripts"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Base/head contents of one changed file; base null = unreadable at base. */
export type FilePair = {
  base: string | null;
  head: string;
};

/**
 * Whether a root-manifest (package.json / scripts/package.json) change must
 * select every image. Allowlist, not blocklist: the change may skip the
 * global trigger ONLY if every differing top-level key is in
 * MANIFEST_ATTRIBUTABLE_KEYS. Parse failure, an unreadable base, or any other
 * differing key → true (fail open).
 */
export function manifestChangeIsGlobal(pair: FilePair): boolean {
  if (pair.base === null) {
    return true;
  }
  let baseRaw: unknown;
  let headRaw: unknown;
  try {
    baseRaw = JSON.parse(pair.base);
    headRaw = JSON.parse(pair.head);
  } catch {
    return true;
  }
  if (!isRecord(baseRaw) || !isRecord(headRaw)) {
    return true;
  }
  const keys = new Set([...Object.keys(baseRaw), ...Object.keys(headRaw)]);
  for (const key of keys) {
    const same =
      JSON.stringify(baseRaw[key] ?? null) ===
      JSON.stringify(headRaw[key] ?? null);
    if (!same && !MANIFEST_ATTRIBUTABLE_KEYS.has(key)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve a changed patch file to the "dep@version" it patches via the HEAD
 * root manifest's patchedDependencies ("dep@version" → "patches/<file>").
 * Patches apply to one exact resolved version, so the caller matches the full
 * key against resolved lockfile ids — an image whose closure resolves a
 * DIFFERENT version of the same dep is correctly unaffected. Returns null
 * when the file has no manifest entry (the caller fails open); an
 * added/removed patch also changes patchedDependencies itself, which is a
 * global key in manifestChangeIsGlobal.
 */
export function patchedDependencyKey(
  path: string,
  rootManifestHead: string,
): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(rootManifestHead);
  } catch {
    return null;
  }
  if (!isRecord(raw)) {
    return null;
  }
  const patched = raw["patchedDependencies"];
  if (!isRecord(patched)) {
    return null;
  }
  for (const [key, value] of Object.entries(patched)) {
    if (value === path) {
      return key;
    }
  }
  return null;
}

/**
 * Parse the subset of JSONC that `bun.lock` uses: strict JSON plus comments
 * and trailing commas. A character scanner (string-aware, so a comma or
 * slash inside a string value is never touched) rather than regex surgery.
 */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  let inString = false;
  const skipWsAndComments = (from: number): number => {
    let j = from;
    while (j < text.length) {
      const d = text[j];
      if (d === " " || d === "\t" || d === "\n" || d === "\r") {
        j += 1;
      } else if (d === "/" && text[j + 1] === "/") {
        while (j < text.length && text[j] !== "\n") j += 1;
      } else if (d === "/" && text[j + 1] === "*") {
        j += 2;
        while (j < text.length && !(text[j] === "*" && text[j + 1] === "/"))
          j += 1;
        j += 2;
      } else {
        break;
      }
    }
    return j;
  };
  while (i < text.length) {
    const c = text.charAt(i);
    if (inString) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      i = skipWsAndComments(i);
      continue;
    }
    if (c === ",") {
      const j = skipWsAndComments(i + 1);
      if (text[j] === "}" || text[j] === "]") {
        i += 1;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return JSON.parse(out);
}

// Top-level bun.lock keys this selector understands. Anything else means the
// lockfile schema moved under us — fail open rather than guess.
const KNOWN_LOCK_KEYS = new Set([
  "lockfileVersion",
  "configVersion",
  "workspaces",
  "packages",
  "patchedDependencies",
  "overrides",
  "catalog",
  "catalogs",
  "trustedDependencies",
]);

// Order matters: hard fields come last so they win the merge, and their
// entries are treated as guaranteed-installed. Peer/optional workspace deps
// (e.g. llm-observability's optional @ai-sdk/otel peer) may legitimately have
// no lockfile resolution.
const WORKSPACE_DEP_FIELDS = [
  { field: "peerDependencies", required: false },
  { field: "optionalDependencies", required: false },
  { field: "devDependencies", required: true },
  { field: "dependencies", required: true },
] as const;

// Dep fields recorded in a resolved package's meta, with whether an entry is
// guaranteed installed. Peers/optionals are walked too when present
// (over-walking can only over-select — the safe direction), but a peer or
// optional dep with NO lockfile resolution is legitimately uninstalled and is
// skipped, while a missing HARD dependency means the lockfile model diverged
// from this walker (throw → fail open). `optionalPeers` is deliberately
// absent — it is an ARRAY marking a subset of peerDependencies as optional,
// and those names are already walked via peerDependencies.
const PACKAGE_DEP_FIELDS = [
  { field: "dependencies", required: true },
  { field: "peerDependencies", required: false },
  { field: "optionalDependencies", required: false },
] as const;

export type Lockfile = {
  /** workspace dir → { package name, merged direct-dep map }. */
  workspaces: Map<
    string,
    {
      name: string;
      deps: Record<string, { spec: string; required: boolean }>;
    }
  >;
  /** resolution key → [id, integrity, meta]. */
  packages: Map<
    string,
    { id: string; integrity: string; meta: Record<string, unknown> }
  >;
  /** Lockfile format identity + global resolution shapers (versions/overrides/catalogs/patches/trusted). */
  sentinel: string;
};

function depMap(
  raw: Record<string, unknown>,
  field: string,
): Record<string, string> {
  const value = raw[field];
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`lockfile ${field} must be an object`);
  const deps: Record<string, string> = {};
  for (const [name, spec] of Object.entries(value)) {
    if (typeof spec !== "string")
      throw new Error(`lockfile ${field} entry ${name} must be a string`);
    deps[name] = spec;
  }
  return deps;
}

function parseLockfileWorkspaces(
  workspacesRaw: Record<string, unknown>,
): Lockfile["workspaces"] {
  const workspaces: Lockfile["workspaces"] = new Map();
  for (const [dir, entry] of Object.entries(workspacesRaw)) {
    if (!isRecord(entry)) throw new Error(`workspace ${dir} must be an object`);
    const name = entry["name"];
    if (typeof name !== "string")
      throw new Error(`workspace ${dir} must have a string name`);
    const merged: Record<string, { spec: string; required: boolean }> = {};
    for (const { field, required } of WORKSPACE_DEP_FIELDS) {
      for (const [depName, spec] of Object.entries(depMap(entry, field))) {
        merged[depName] = { spec, required };
      }
    }
    workspaces.set(dir, { name, deps: merged });
  }
  return workspaces;
}

function parseLockfilePackages(
  packagesRaw: Record<string, unknown>,
): Lockfile["packages"] {
  const packages: Lockfile["packages"] = new Map();
  for (const [key, entry] of Object.entries(packagesRaw)) {
    if (!Array.isArray(entry)) {
      throw new TypeError(`lockfile package ${key} has an unexpected shape`);
    }
    const list: unknown[] = entry;
    const id = list[0];
    if (typeof id !== "string") {
      throw new TypeError(`lockfile package ${key} has an unexpected shape`);
    }
    const meta = list.find(isRecord) ?? {};
    const last = list.at(-1);
    const integrity =
      typeof last === "string" && last.startsWith("sha") ? last : "";
    packages.set(key, { id, integrity, meta });
  }
  return packages;
}

export function parseLockfile(text: string): Lockfile {
  const raw = parseJsonc(text);
  if (!isRecord(raw)) throw new Error("lockfile must be an object");
  for (const key of Object.keys(raw)) {
    if (!KNOWN_LOCK_KEYS.has(key))
      throw new Error(`unknown lockfile key: ${key}`);
  }
  const workspacesRaw = raw["workspaces"];
  const packagesRaw = raw["packages"];
  if (!isRecord(workspacesRaw) || !isRecord(packagesRaw))
    throw new Error("lockfile workspaces/packages must be objects");

  const workspaces = parseLockfileWorkspaces(workspacesRaw);
  const packages = parseLockfilePackages(packagesRaw);

  // Lockfile format identity (lockfileVersion/configVersion) leads the global
  // resolution shapers. A bun format bump can rewrite resolution semantics
  // without changing any single dep spec, so folding both into the sentinel
  // flips EVERY closure fingerprint on a format change — image selection fails
  // open to all targets instead of silently selecting none. Both are in
  // KNOWN_LOCK_KEYS.
  const sentinel = JSON.stringify([
    raw["lockfileVersion"] ?? null,
    raw["configVersion"] ?? null,
    raw["patchedDependencies"] ?? null,
    raw["overrides"] ?? null,
    raw["catalog"] ?? null,
    raw["catalogs"] ?? null,
    raw["trustedDependencies"] ?? null,
  ]);

  return { workspaces, packages, sentinel };
}

/**
 * Resolve a dep name the way bun's nested lockfile keys shadow: the
 * `<parentPackageName>/<depName>` key wins over the bare `<depName>` key.
 * (Nested keys are parent-NAME scoped, e.g. "astro/sharp",
 * "@ai-sdk/amazon-bedrock/@ai-sdk/anthropic".) An unresolvable dep means the
 * lockfile model diverged from this walker — throw (the caller fails open).
 */
function resolvePackageKey(
  name: string,
  parentName: string,
  packages: Lockfile["packages"],
): string | null {
  if (parentName !== "") {
    const nested = `${parentName}/${name}`;
    if (packages.has(nested)) return nested;
  }
  if (packages.has(name)) return name;
  return null;
}

/** "name@version" | "@scope/name@version" | "name@workspace:dir" → the name. */
function packageNameOfId(id: string): string {
  const at = id.lastIndexOf("@");
  if (at <= 0) throw new Error(`lockfile package id has no version: ${id}`);
  return id.slice(0, at);
}

/**
 * Deterministic fingerprint of every resolved package reachable from the
 * closure's workspace dirs in this lockfile. Returns null when a closure dir
 * is missing from the lockfile (membership changed → treat as changed).
 */
export function closureFingerprint(
  closureDirs: readonly string[],
  lock: Lockfile,
): string | null {
  const acc = new Set<string>();
  const queue: { name: string; parentName: string; required: boolean }[] = [];
  for (const dir of closureDirs) {
    const workspace = lock.workspaces.get(dir);
    if (workspace === undefined) return null;
    for (const [name, { spec, required }] of Object.entries(workspace.deps)) {
      acc.add(`workspace:${dir}:${name}@${spec}`);
      if (!spec.startsWith("workspace:"))
        queue.push({ name, parentName: workspace.name, required });
    }
  }
  const seen = new Set<string>();
  while (queue.length > 0) {
    const next = queue.pop();
    if (next === undefined) break;
    const key = resolvePackageKey(next.name, next.parentName, lock.packages);
    if (key === null) {
      if (next.required)
        throw new Error(
          `lockfile has no resolution for ${next.name} under ${next.parentName}`,
        );
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = lock.packages.get(key);
    if (entry === undefined) throw new Error(`lockfile lost key ${key}`);
    acc.add(`${key}=${entry.id}#${entry.integrity}`);
    // Workspace members reached through the graph are covered by closureDirs.
    if (entry.id.includes("@workspace:")) continue;
    const parentName = packageNameOfId(entry.id);
    for (const { field, required } of PACKAGE_DEP_FIELDS) {
      for (const name of Object.keys(depMap(entry.meta, field))) {
        queue.push({ name, parentName, required });
      }
    }
  }
  acc.add(`sentinel:${lock.sentinel}`);
  return [...acc].sort().join("\n");
}

/**
 * Every resolved package ID ("name@version") reachable from the closure's
 * workspace dirs in this lockfile, plus the workspace member names. Same
 * graph walk as closureFingerprint, accumulating ids instead of resolution
 * fingerprint lines — used to match version-exact patchedDependencies keys.
 * Returns null when a closure dir is missing from the lockfile (membership
 * changed → caller fails open).
 */
export function closurePackageIds(
  closureDirs: readonly string[],
  lock: Lockfile,
): Set<string> | null {
  const ids = new Set<string>();
  const queue: { name: string; parentName: string; required: boolean }[] = [];
  for (const dir of closureDirs) {
    const workspace = lock.workspaces.get(dir);
    if (workspace === undefined) return null;
    ids.add(workspace.name);
    for (const [name, { spec, required }] of Object.entries(workspace.deps)) {
      if (!spec.startsWith("workspace:"))
        queue.push({ name, parentName: workspace.name, required });
    }
  }
  const seen = new Set<string>();
  while (queue.length > 0) {
    const next = queue.pop();
    if (next === undefined) break;
    const key = resolvePackageKey(next.name, next.parentName, lock.packages);
    if (key === null) {
      if (next.required)
        throw new Error(
          `lockfile has no resolution for ${next.name} under ${next.parentName}`,
        );
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = lock.packages.get(key);
    if (entry === undefined) throw new Error(`lockfile lost key ${key}`);
    ids.add(entry.id);
    const parentName = packageNameOfId(entry.id);
    // Workspace members reached through the graph are covered by closureDirs.
    if (entry.id.includes("@workspace:")) continue;
    for (const { field, required } of PACKAGE_DEP_FIELDS) {
      for (const name of Object.keys(depMap(entry.meta, field))) {
        queue.push({ name, parentName, required });
      }
    }
  }
  return ids;
}

export type LockfilePair = {
  /** null when the base lockfile is unreadable — treated as fully changed. */
  base: string | null;
  head: string;
};
