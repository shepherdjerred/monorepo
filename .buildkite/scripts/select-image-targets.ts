#!/usr/bin/env bun

/**
 * Select the image targets whose owned workspace closure changed.
 *
 * This intentionally does not call Turbo or require node_modules. Image
 * selection happens before the expensive toolchain/install/build work, and a
 * selector failure is handled by bake-images.sh by building every target.
 */

interface WorkspacePackage {
  readonly dir: string;
  readonly workspaceDependencies: readonly string[];
}

const TARGET_OWNERS: Readonly<Record<string, string>> = {
  birmel: "@shepherdjerred/birmel",
  "tasknotes-server": "tasknotes-server",
  "starlight-karma-bot": "starlight-karma-bot",
  streambot: "@shepherdjerred/streambot",
  "temporal-worker": "@shepherdjerred/temporal",
  "trmnl-dashboard": "@shepherdjerred/trmnl-dashboard",
  "scout-for-lol": "@scout-for-lol/backend",
  "discord-plays-pokemon": "@discord-plays-pokemon/backend",
  "discord-plays-mario-kart": "@discord-plays-mario-kart/backend",
};

export const ALL_IMAGE_TARGETS = [
  ...Object.keys(TARGET_OWNERS),
  "infra",
].sort();

// Paths whose change means "build everything", unconditionally. Deliberately
// NOT here, because their changes are attributed per image instead (each with
// fail-open to ALL on any parse surprise):
// - bun.lock — closure resolution fingerprints (below).
// - package.json / scripts/package.json — content-aware: a delta confined to
//   devDependencies/scripts is repo tooling that ships in no image; the
//   accompanying bun.lock change is attributed by the fingerprints. Any other
//   key (workspaces, overrides, patchedDependencies, trustedDependencies, …)
//   still selects ALL.
// - patches/ — each patch file maps to one dependency via the manifest's
//   patchedDependencies; only images whose closure contains that dependency
//   are selected.
// - .buildkite/ — only the files that shape image builds/selection are
//   global; other CI scripts don't change image content.
const GLOBAL_IMAGE_INPUTS = [
  ".buildkite/pipeline.yml",
  ".buildkite/scripts/bake-images.sh",
  ".buildkite/scripts/bake-retry.sh",
  ".buildkite/scripts/buildkit-env.sh",
  ".buildkite/scripts/docker-env.sh",
  ".buildkite/scripts/select-image-targets.ts",
  // Staged into every Dockerfile's smoke stage — a harness change must
  // re-run every image's in-image smoke.
  ".buildkite/scripts/smoke-app-in-image.ts",
  ".dockerignore",
  ".mise.toml",
  "docker-bake.hcl",
  "bunfig.toml",
  "turbo.json",
  "tsconfig.base.json",
];

// Top-level root-manifest keys whose changes are NOT global: repo tooling
// (devDependencies: turbo, prettier, knip, …) and script text ship in no
// image. Everything else — workspaces, overrides, patchedDependencies,
// trustedDependencies, packageManager — shapes resolution or install behavior
// for every image and stays global.
const MANIFEST_ATTRIBUTABLE_KEYS = new Set(["devDependencies", "scripts"]);

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

const TARGET_PATH_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  "scout-for-lol": ["packages/scout-for-lol/tsconfig.base.json"],
  // Temporal compiles toolkit into the worker image as an embedded CLI, but
  // toolkit is deliberately not a runtime workspace dependency.
  "temporal-worker": ["packages/toolkit/"],
  "discord-plays-pokemon": ["packages/discord-plays-pokemon/"],
  "discord-plays-mario-kart": ["packages/discord-plays-mario-kart/"],
  infra: [
    "packages/homelab/images/",
    "packages/homelab/scripts/smoke-images.ts",
    "packages/homelab/src/cdk8s/scripts/generate-caddyfile.ts",
    "packages/homelab/src/cdk8s/src/misc/common.ts",
    "packages/homelab/src/cdk8s/src/misc/s3-static-site.ts",
    "packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts",
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

async function loadWorkspaces(
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

function dependencyClosure(
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

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix;
}

/** Base/head contents of one changed file; base null = unreadable at base. */
export interface FilePair {
  base: string | null;
  head: string;
}

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
    const c = text[i];
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

interface Lockfile {
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
}

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

  const workspaces = new Map<
    string,
    { name: string; deps: Record<string, { spec: string; required: boolean }> }
  >();
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

  const packages = new Map<
    string,
    { id: string; integrity: string; meta: Record<string, unknown> }
  >();
  for (const [key, entry] of Object.entries(packagesRaw)) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string")
      throw new Error(`lockfile package ${key} has an unexpected shape`);
    const id = entry[0];
    const meta = entry.find(isRecord) ?? {};
    const last = entry[entry.length - 1];
    const integrity =
      typeof last === "string" && last.startsWith("sha") ? last : "";
    packages.set(key, { id, integrity, meta });
  }

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

export interface LockfilePair {
  /** null when the base lockfile is unreadable — treated as fully changed. */
  base: string | null;
  head: string;
}

/** Optional changed-file contents the selector attributes precisely. */
export interface SelectorInputs {
  lockfiles?: LockfilePair;
  rootPackageJson?: FilePair;
  scriptsPackageJson?: FilePair;
}

function lockfileChangedTargets(
  lockfiles: LockfilePair,
  packages: ReadonlyMap<string, WorkspacePackage>,
): Set<string> {
  if (lockfiles.base === null) throw new Error("base lockfile unavailable");
  const base = parseLockfile(lockfiles.base);
  const head = parseLockfile(lockfiles.head);
  const changed = new Set<string>();
  for (const [target, owner] of Object.entries(TARGET_OWNERS)) {
    const closureDirs = targetClosureDirs(target, owner, packages);
    const baseFp = closureFingerprint(closureDirs, base);
    const headFp = closureFingerprint(closureDirs, head);
    if (baseFp === null || headFp === null || baseFp !== headFp) {
      changed.add(target);
    }
  }
  return changed;
}

/**
 * Why each target was (or every target had to be) selected. The reasons are a
 * byproduct of the selection walk itself — this report is the ONLY place they
 * survive; stdout stays the bare target array for the shell consumers.
 */
export interface SelectionReport {
  /** Git ref the diff was computed against (null when unknown to the caller). */
  base: string | null;
  changedPaths: string[];
  /** "all" = a fail-open or global input forced every target. */
  mode: "selected" | "all";
  /** Set exactly when mode === "all": the single reason everything rebuilds. */
  globalReason: string | null;
  /** Per-target reasons; in "all" mode every target carries the global reason. */
  targets: Record<string, string[]>;
}

export interface SelectionResult {
  targets: string[];
  report: SelectionReport;
}

function allTargetsResult(
  changedPaths: readonly string[],
  globalReason: string,
): SelectionResult {
  return {
    targets: [...ALL_IMAGE_TARGETS],
    report: {
      base: null,
      changedPaths: [...changedPaths],
      mode: "all",
      globalReason,
      targets: Object.fromEntries(
        ALL_IMAGE_TARGETS.map((target) => [target, [globalReason]]),
      ),
    },
  };
}

function addReason(
  reasons: Map<string, string[]>,
  target: string,
  reason: string,
): void {
  const existing = reasons.get(target);
  if (existing === undefined) {
    reasons.set(target, [reason]);
  } else if (!existing.includes(reason)) {
    existing.push(reason);
  }
}

export async function selectImageTargetsWithReasons(
  changedPaths: readonly string[],
  repoRoot = process.cwd(),
  inputs?: SelectorInputs,
): Promise<SelectionResult> {
  for (const path of changedPaths) {
    const prefix = GLOBAL_IMAGE_INPUTS.find((candidate) =>
      pathMatchesPrefix(path, candidate),
    );
    if (prefix !== undefined) {
      return allTargetsResult(
        changedPaths,
        `global image input changed: ${path} (matches ${prefix})`,
      );
    }
  }

  // Root manifests: global unless the delta is confined to attributable keys
  // (repo tooling). The accompanying bun.lock change — if any — is attributed
  // by the closure fingerprints below; the root workspace is in no image
  // closure, so a pure tooling bump correctly selects nothing. A missing pair
  // fails open.
  const manifestPairs: readonly (readonly [string, FilePair | undefined])[] = [
    ["package.json", inputs?.rootPackageJson],
    ["scripts/package.json", inputs?.scriptsPackageJson],
  ];
  for (const [path, pair] of manifestPairs) {
    if (!changedPaths.includes(path)) continue;
    if (pair === undefined) {
      return allTargetsResult(
        changedPaths,
        `${path} changed but base/head contents were unavailable (fail-open)`,
      );
    }
    if (manifestChangeIsGlobal(pair)) {
      return allTargetsResult(
        changedPaths,
        `${path} changed outside attributable keys (devDependencies/scripts)`,
      );
    }
  }

  const packages = await loadWorkspaces(repoRoot);
  const reasons = new Map<string, string[]>();

  for (const [target, owner] of Object.entries(TARGET_OWNERS)) {
    const closure = dependencyClosure(owner, packages);
    const dirs = [...closure].map((name) => {
      const pkg = packages.get(name);
      if (pkg === undefined) {
        throw new Error(
          `workspace disappeared while selecting images: ${name}`,
        );
      }
      return pkg.dir;
    });
    for (const path of changedPaths) {
      const dir = dirs.find((candidate) => path.startsWith(candidate));
      if (dir !== undefined) {
        addReason(reasons, target, `workspace closure: ${path} under ${dir}`);
        break;
      }
    }
  }

  for (const [target, prefixes] of Object.entries(TARGET_PATH_PREFIXES)) {
    for (const path of changedPaths) {
      const prefix = prefixes.find((candidate) =>
        pathMatchesPrefix(path, candidate),
      );
      if (prefix !== undefined) {
        addReason(
          reasons,
          target,
          `configured extra input: ${path} (matches ${prefix})`,
        );
        break;
      }
    }
  }

  // Attribute each changed patch file to the images whose closure contains
  // the patched dependency, via the HEAD manifest + HEAD lockfile (a
  // patch-content edit doesn't touch bun.lock, so this reads HEAD state
  // directly). Any surprise fails OPEN to every target.
  const patchPaths = changedPaths.filter((path) => path.startsWith("patches/"));
  if (patchPaths.length > 0) {
    try {
      const manifestHead =
        inputs?.rootPackageJson?.head ??
        (await Bun.file(`${repoRoot}/package.json`).text());
      const lockHead =
        inputs?.lockfiles?.head ??
        (await Bun.file(`${repoRoot}/bun.lock`).text());
      const lock = parseLockfile(lockHead);
      const closureIds = new Map<string, Set<string>>();
      for (const [target, owner] of Object.entries(TARGET_OWNERS)) {
        const dirs = targetClosureDirs(target, owner, packages);
        const ids = closurePackageIds(dirs, lock);
        if (ids === null) {
          throw new Error(`closure dirs missing from lockfile for ${target}`);
        }
        closureIds.set(target, ids);
      }
      for (const path of patchPaths) {
        const key = patchedDependencyKey(path, manifestHead);
        if (key === null) {
          throw new Error(`no patchedDependencies entry for ${path}`);
        }
        for (const [target, ids] of closureIds) {
          if (ids.has(key)) {
            addReason(
              reasons,
              target,
              `patched dependency ${key} (${path}) in closure`,
            );
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `select-image-targets: patch attribution failed (${message}); selecting ALL targets`,
      );
      return allTargetsResult(
        changedPaths,
        `patch attribution failed (${message}); fail-open`,
      );
    }
  }

  if (changedPaths.includes("bun.lock")) {
    // Attribute the lockfile diff to image closures via resolved-dependency
    // fingerprints. Any surprise (schema drift, unreadable base, resolution
    // miss) fails OPEN to every target — selection can only save work, never
    // omit a required image.
    try {
      if (inputs?.lockfiles === undefined)
        throw new Error("bun.lock changed but no lockfile contents provided");
      for (const target of lockfileChangedTargets(inputs.lockfiles, packages)) {
        addReason(
          reasons,
          target,
          "resolved dependency closure changed in bun.lock",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `select-image-targets: lockfile attribution failed (${message}); selecting ALL targets`,
      );
      return allTargetsResult(
        changedPaths,
        `lockfile attribution failed (${message}); fail-open`,
      );
    }
  }

  const targets = [...reasons.keys()].sort();
  return {
    targets,
    report: {
      base: null,
      changedPaths: [...changedPaths],
      mode: "selected",
      globalReason: null,
      targets: Object.fromEntries(
        targets.map((target) => {
          const targetReasons = reasons.get(target);
          if (targetReasons === undefined) {
            throw new Error(`missing reasons for selected target ${target}`);
          }
          return [target, targetReasons];
        }),
      ),
    },
  };
}

export async function selectImageTargets(
  changedPaths: readonly string[],
  repoRoot = process.cwd(),
  inputs?: SelectorInputs,
): Promise<string[]> {
  const { targets } = await selectImageTargetsWithReasons(
    changedPaths,
    repoRoot,
    inputs,
  );
  return targets;
}

export async function changedPathsSince(
  base: string,
  repoRoot = process.cwd(),
): Promise<string[]> {
  const proc = Bun.spawn(
    ["git", "diff", "--no-renames", "--name-only", "-z", base, "HEAD"],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`git diff failed with exit code ${exitCode.toString()}`);
  }
  return stdout.split("\0").filter((path) => path.length > 0);
}

async function baseFile(
  base: string,
  path: string,
  repoRoot = process.cwd(),
): Promise<string | null> {
  const proc = Bun.spawn(["git", "show", `${base}:${path}`], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "inherit",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) return null;
  return stdout;
}

async function changedFilePair(base: string, path: string): Promise<FilePair> {
  return {
    base: await baseFile(base, path),
    head: await Bun.file(path).text(),
  };
}

async function main(): Promise<void> {
  const baseFlag = Bun.argv.indexOf("--base");
  const base = baseFlag === -1 ? undefined : Bun.argv[baseFlag + 1];
  if (base === undefined || base === "") {
    console.error(
      "Usage: select-image-targets.ts --base <git-ref> [--reasons-out <file>]",
    );
    process.exit(2);
  }
  // Justification side channel: stdout is a strict one-line JSON-array
  // contract (bake-images.sh jq-validates it; ci-changed.sh string-compares
  // it), so the per-target reasons report goes to a file instead.
  const reasonsFlag = Bun.argv.indexOf("--reasons-out");
  const reasonsOut = reasonsFlag === -1 ? undefined : Bun.argv[reasonsFlag + 1];
  if (reasonsFlag !== -1 && (reasonsOut === undefined || reasonsOut === "")) {
    console.error("--reasons-out requires a file path");
    process.exit(2);
  }
  const changedPaths = await changedPathsSince(base);
  const inputs: SelectorInputs = {};
  if (changedPaths.includes("bun.lock")) {
    inputs.lockfiles = await changedFilePair(base, "bun.lock");
  }
  if (changedPaths.includes("package.json")) {
    inputs.rootPackageJson = await changedFilePair(base, "package.json");
  }
  if (changedPaths.includes("scripts/package.json")) {
    inputs.scriptsPackageJson = await changedFilePair(
      base,
      "scripts/package.json",
    );
  }
  const { targets, report } = await selectImageTargetsWithReasons(
    changedPaths,
    process.cwd(),
    inputs,
  );
  if (reasonsOut !== undefined) {
    await Bun.write(reasonsOut, JSON.stringify({ ...report, base }, null, 2));
  }
  console.log(JSON.stringify(targets));
}

if (import.meta.main) {
  await main();
}
