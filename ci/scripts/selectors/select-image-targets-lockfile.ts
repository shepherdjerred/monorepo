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

/** Skip a `//` comment starting at `from` (the first slash); stops at `\n`. */
function skipLineComment(text: string, from: number): number {
  let j = from;
  while (j < text.length && text[j] !== "\n") j += 1;
  return j;
}

/** Skip a `/*` comment starting at `from` (the slash); stops past `*\/`. */
function skipBlockComment(text: string, from: number): number {
  let j = from + 2;
  while (j < text.length && !(text[j] === "*" && text[j + 1] === "/")) j += 1;
  return j + 2;
}

function skipWsAndComments(text: string, from: number): number {
  let j = from;
  while (j < text.length) {
    const d = text[j];
    if (d === " " || d === "\t" || d === "\n" || d === "\r") {
      j += 1;
    } else if (d === "/" && text[j + 1] === "/") {
      j = skipLineComment(text, j);
    } else if (d === "/" && text[j + 1] === "*") {
      j = skipBlockComment(text, j);
    } else {
      break;
    }
  }
  return j;
}

type JsoncScan = {
  out: string;
  i: number;
  inString: boolean;
};

/** Append one string-mode character (handling escapes and the closing quote). */
function appendStringChar(text: string, state: JsoncScan): void {
  const c = text.charAt(state.i);
  state.out += c;
  if (c === "\\") {
    state.out += text[state.i + 1] ?? "";
    state.i += 2;
    return;
  }
  if (c === '"') state.inString = false;
  state.i += 1;
}

/**
 * The index past a trailing comma (`,` followed only by `}`/`]`), or null
 * when the comma at `commaAt` separates values.
 */
function endOfTrailingComma(text: string, commaAt: number): number | null {
  const j = skipWsAndComments(text, commaAt + 1);
  return text[j] === "}" || text[j] === "]" ? commaAt + 1 : null;
}

/**
 * Parse the subset of JSONC that `bun.lock` uses: strict JSON plus comments
 * and trailing commas. A character scanner (string-aware, so a comma or
 * slash inside a string value is never touched) rather than regex surgery.
 */
export function parseJsonc(text: string): unknown {
  const state: JsoncScan = { out: "", i: 0, inString: false };
  while (state.i < text.length) {
    const c = text.charAt(state.i);
    if (state.inString) {
      appendStringChar(text, state);
      continue;
    }
    if (c === '"') {
      state.inString = true;
      state.out += c;
      state.i += 1;
      continue;
    }
    if (c === "/" && (text[state.i + 1] === "/" || text[state.i + 1] === "*")) {
      state.i = skipWsAndComments(text, state.i);
      continue;
    }
    if (c === ",") {
      const end = endOfTrailingComma(text, state.i);
      if (end !== null) {
        state.i = end;
        continue;
      }
    }
    state.out += c;
    state.i += 1;
  }
  return JSON.parse(state.out);
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
  return packages.has(name) ? name : null;
}

/** "name@version" | "@scope/name@version" | "name@workspace:dir" → the name. */
function packageNameOfId(id: string): string {
  const at = id.lastIndexOf("@");
  if (at <= 0) throw new Error(`lockfile package id has no version: ${id}`);
  return id.slice(0, at);
}

type ResolutionQueueEntry = {
  name: string;
  parentName: string;
  required: boolean;
};

type LockWorkspaceEntry =
  Lockfile["workspaces"] extends Map<string, infer Entry> ? Entry : never;

type LockPackageEntry =
  Lockfile["packages"] extends Map<string, infer Entry> ? Entry : never;

/**
 * Seed the resolution queue from the closure's workspace dirs. Returns null
 * when a closure dir is missing from the lockfile (membership changed).
 */
function seedResolutionQueue(
  closureDirs: readonly string[],
  lock: Lockfile,
  onWorkspace: (dir: string, workspace: LockWorkspaceEntry) => void,
): ResolutionQueueEntry[] | null {
  const queue: ResolutionQueueEntry[] = [];
  for (const dir of closureDirs) {
    const workspace = lock.workspaces.get(dir);
    if (workspace === undefined) return null;
    onWorkspace(dir, workspace);
    for (const [name, { spec, required }] of Object.entries(workspace.deps)) {
      if (!spec.startsWith("workspace:"))
        queue.push({ name, parentName: workspace.name, required });
    }
  }
  return queue;
}

type QueueVisit = {
  lock: Lockfile;
  seen: Set<string>;
  queue: ResolutionQueueEntry[];
  onEntry: (key: string, entry: LockPackageEntry) => void;
};

/**
 * Visit one queued dep: resolve it, call onEntry, and enqueue its own deps.
 * Throws on a required dep with no resolution; skips optional ones.
 */
function visitQueueEntry(next: ResolutionQueueEntry, visit: QueueVisit): void {
  const key = resolvePackageKey(
    next.name,
    next.parentName,
    visit.lock.packages,
  );
  if (key === null) {
    if (next.required)
      throw new Error(
        `lockfile has no resolution for ${next.name} under ${next.parentName}`,
      );
    return;
  }
  if (visit.seen.has(key)) return;
  visit.seen.add(key);
  const entry = visit.lock.packages.get(key);
  if (entry === undefined) throw new Error(`lockfile lost key ${key}`);
  visit.onEntry(key, entry);
  // Workspace members reached through the graph are covered by closureDirs.
  if (entry.id.includes("@workspace:")) return;
  const parentName = packageNameOfId(entry.id);
  for (const { field, required } of PACKAGE_DEP_FIELDS) {
    for (const name of Object.keys(depMap(entry.meta, field))) {
      visit.queue.push({ name, parentName, required });
    }
  }
}

/**
 * Drain the resolution queue the way bun's nested lockfile keys shadow,
 * calling onEntry for every resolved package.
 */
function drainResolutionQueue(
  queue: ResolutionQueueEntry[],
  lock: Lockfile,
  onEntry: (key: string, entry: LockPackageEntry) => void,
): void {
  const visit: QueueVisit = { lock, seen: new Set<string>(), queue, onEntry };
  while (visit.queue.length > 0) {
    const next = visit.queue.pop();
    if (next === undefined) break;
    visitQueueEntry(next, visit);
  }
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
  const queue = seedResolutionQueue(closureDirs, lock, (dir, workspace) => {
    for (const [name, { spec }] of Object.entries(workspace.deps)) {
      acc.add(`workspace:${dir}:${name}@${spec}`);
    }
  });
  if (queue === null) return null;
  drainResolutionQueue(queue, lock, (key, entry) => {
    acc.add(`${key}=${entry.id}#${entry.integrity}`);
  });
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
  const queue = seedResolutionQueue(closureDirs, lock, (_dir, workspace) => {
    ids.add(workspace.name);
  });
  if (queue === null) return null;
  drainResolutionQueue(queue, lock, (_key, entry) => {
    ids.add(entry.id);
  });
  return ids;
}

export type LockfilePair = {
  /** null when the base lockfile is unreadable — treated as fully changed. */
  base: string | null;
  head: string;
};
