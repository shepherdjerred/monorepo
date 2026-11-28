/**
 * What a change to `package.json` or `bun.lock` can do to Prettier's output.
 *
 * Both files used to force every Prettier shard to run in full whenever a
 * commit in the compared range touched them. They change on roughly one
 * commit in ten (a new package, a dependency bump, a script), almost never in
 * a way Prettier can observe, so a red `main` or any PR that added a package
 * re-formatted the whole repository. Prettier's output depends on only three
 * things in these files: a `prettier` configuration key in `package.json`,
 * the resolved versions of Prettier and its plugins in `bun.lock`, and patches
 * or overrides naming them. The slices below capture exactly that, so two
 * revisions whose slices are equal cannot format any file differently.
 *
 * Every slice errs towards including too much: a spurious difference costs one
 * full shard run, a missed one lets a formatting regression through.
 */

import { z } from "zod";

/** Files whose Prettier-visible content is a slice, not the whole file. */
export const PRETTIER_TOOLCHAIN_FILES: readonly string[] = [
  "bun.lock",
  "package.json",
];

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

const POLICY_SECTIONS = ["overrides", "resolutions"] as const;

const MENTIONS_PRETTIER = "prettier";

const PackageJsonSchema = z.record(z.string(), z.unknown());

const LockSchema = z
  .object({
    packages: z.record(z.string(), z.array(z.unknown()).min(1)),
    patchedDependencies: z.record(z.string(), z.unknown()).optional(),
    overrides: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const LockEntryMetadataSchema = z
  .object({
    dependencies: z.record(z.string(), z.unknown()).optional(),
    optionalDependencies: z.record(z.string(), z.unknown()).optional(),
    peerDependencies: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const PrettierConfigSchema = z.unknown();

/**
 * Packages that are Prettier or a Prettier plugin by naming convention:
 * `prettier`, `prettier-plugin-*` (scoped or not) and `@prettier/*`. Packages
 * that merely mention it, such as `eslint-config-prettier`, do not change
 * formatting.
 */
function isPrettierPackage(unit: string): boolean {
  return (
    unit === "prettier" ||
    /^(?:@[^/]+\/)?prettier-plugin-/u.test(unit) ||
    unit.startsWith("@prettier/")
  );
}

function mentionsPrettier(key: string, value: unknown): boolean {
  return (
    key.includes(MENTIONS_PRETTIER) ||
    JSON.stringify(value).includes(MENTIONS_PRETTIER)
  );
}

function pluginSpecifiers(node: unknown, specifiers: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) pluginSpecifiers(item, specifiers);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "plugins" && Array.isArray(value)) {
      for (const plugin of value) {
        if (typeof plugin === "string") specifiers.add(plugin);
      }
    }
    pluginSpecifiers(value, specifiers);
  }
}

/**
 * The package a plugin (or shared configuration) specifier loads:
 * `@acme/fmt/plugin` is `@acme/fmt`. Anything that is not a package name, such
 * as a relative path, an absolute path or a URL, cannot be tied to a lockfile
 * entry, so it throws and the caller checks in full rather than guessing.
 */
function pluginPackageName(specifier: string): string {
  const parts = specifier.split("/");
  const name = specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : parts[0];
  if (
    name === undefined ||
    name === "" ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.includes(":") ||
    (specifier.startsWith("@") && parts.length < 2)
  ) {
    throw new Error(
      `Prettier plugin ${JSON.stringify(specifier)} is not a package name`,
    );
  }
  return name;
}

/**
 * Packages the Prettier configuration loads: the `plugins` of
 * `.prettierrc.json` and of the root `package.json` `prettier` key (a string
 * there names a shared configuration package). Throws for a specifier that is
 * not a package name.
 */
export function prettierPluginNames(
  configText: string | null,
  manifestText: string | null,
): string[] {
  const specifiers = new Set<string>();
  if (configText !== null) {
    const config = PrettierConfigSchema.parse(JSON.parse(configText));
    // A string configuration names a shared configuration package.
    if (typeof config === "string") specifiers.add(config);
    else pluginSpecifiers(config, specifiers);
  }
  if (manifestText !== null) {
    const manifest = PackageJsonSchema.parse(JSON.parse(manifestText));
    const config = manifest["prettier"];
    if (typeof config === "string") specifiers.add(config);
    else pluginSpecifiers(config, specifiers);
  }
  return [...specifiers].map((entry) => pluginPackageName(entry)).toSorted();
}

/**
 * The part of `package.json` Prettier can read: its own configuration key,
 * the dependency entries of Prettier and its plugins, overrides and
 * resolutions that mention it, and every patch entry (a patch can alter any
 * package in the closure). Resolved versions live in the lockfile slice.
 */
export function prettierPackageJsonSlice(text: string): string {
  const manifest = PackageJsonSchema.parse(JSON.parse(text));
  const slice: Record<string, unknown> = {};
  if ("prettier" in manifest) slice["prettier"] = manifest["prettier"];
  const sections: [string, (key: string, value: unknown) => boolean][] = [
    ...DEPENDENCY_SECTIONS.map(
      (section): [string, (key: string, value: unknown) => boolean] => [
        section,
        (key) => isPrettierPackage(key),
      ],
    ),
    ...POLICY_SECTIONS.map(
      (section): [string, (key: string, value: unknown) => boolean] => [
        section,
        mentionsPrettier,
      ],
    ),
    // A patch can change any package in the closure, not only Prettier's own.
    ["patchedDependencies", () => true],
  ];
  for (const [section, keep] of sections) {
    // An absent section holds nothing; a present one of the wrong shape is
    // corrupt, so parsing throws and the caller checks in full.
    if (!(section in manifest)) continue;
    const kept = Object.entries(PackageJsonSchema.parse(manifest[section]))
      .filter(([key, value]) => keep(key, value))
      .toSorted(([left], [right]) => left.localeCompare(right));
    if (kept.length > 0) slice[section] = kept;
  }
  return JSON.stringify(slice);
}

/** `a/b/c` and `@s/a/@s/b` split into package units: `["a","b","c"]`. */
function packageUnits(key: string): string[] {
  const parts = key.split("/");
  const units: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === undefined) continue;
    const next = parts[index + 1];
    if (next !== undefined && part.startsWith("@")) {
      units.push(`${part}/${next}`);
      index++;
    } else {
      units.push(part);
    }
  }
  return units;
}

/**
 * Dependencies an entry declares. Its metadata object sits at index 2 for a
 * registry package and at index 1 for a git, github or tarball one, so the
 * first object in the tuple is read; a malformed one throws and the caller
 * checks in full. An entry with no metadata object (a workspace link) has no
 * dependencies of its own.
 */
function dependencyNames(entry: readonly unknown[]): string[] {
  const found = entry.find(
    (item) => typeof item === "object" && item !== null && !Array.isArray(item),
  );
  if (found === undefined) return [];
  const metadata = LockEntryMetadataSchema.parse(found);
  return [
    ...Object.keys(metadata.dependencies ?? {}),
    ...Object.keys(metadata.optionalDependencies ?? {}),
    ...Object.keys(metadata.peerDependencies ?? {}),
  ];
}

/** Seed entries (Prettier, its plugins) and everything they depend on. */
function lockClosure(
  packages: Readonly<Record<string, readonly unknown[]>>,
  pluginNames: ReadonlySet<string>,
): Set<string> {
  const keys = new Set(Object.keys(packages));
  const selected = new Set<string>();
  const queue: string[] = [];
  const select = (key: string): void => {
    if (selected.has(key)) return;
    selected.add(key);
    queue.push(key);
  };
  for (const key of keys) {
    const name = packageUnits(key).at(-1) ?? key;
    if (isPrettierPackage(name) || pluginNames.has(name)) select(key);
  }
  for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
    const entry = packages[key];
    if (entry === undefined) continue;
    const units = packageUnits(key);
    for (const dependency of dependencyNames(entry)) {
      for (let depth = units.length; depth >= 0; depth--) {
        const candidate = [...units.slice(0, depth), dependency].join("/");
        if (keys.has(candidate)) select(candidate);
      }
    }
  }
  return selected;
}

/**
 * Lock entries that decide which Prettier and plugin code runs: every entry
 * whose package name mentions Prettier or is a configured plugin, plus
 * everything those entries depend on. A dependency is looked up the way Node
 * resolves it, from the package's own nested path up to the top level, and
 * every match on that path is kept.
 */
export function prettierLockSlice(
  lockText: string,
  plugins: readonly string[],
): string {
  const lock = LockSchema.parse(Bun.JSONC.parse(lockText));
  const keys = new Set(Object.keys(lock.packages));
  for (const plugin of plugins) {
    if (!keys.has(plugin)) {
      throw new Error(`Prettier plugin ${plugin} has no bun.lock entry`);
    }
  }
  const selected = lockClosure(lock.packages, new Set(plugins));
  const packages = [...selected]
    .toSorted((left, right) => left.localeCompare(right))
    .map((key) => [key, lock.packages[key]]);
  const policies = [
    [lock.patchedDependencies, () => true],
    [lock.overrides, mentionsPrettier],
  ] as const;
  const kept = policies.map(([section, keep]) =>
    Object.entries(section ?? {})
      .filter(([key, value]) => keep(key, value))
      .toSorted(([left], [right]) => left.localeCompare(right)),
  );
  return JSON.stringify({ packages, policies: kept });
}

export type ToolchainRevision = {
  readonly "bun.lock": string | null;
  readonly "package.json": string | null;
};

/**
 * Whether the Prettier-visible content of `package.json` and `bun.lock` differs
 * between two revisions. `changed` names the toolchain files the range
 * touched; only those are compared. A file missing on one side differs.
 * Returns `null` when a slice cannot be read, so the caller checks in full.
 */
export function prettierToolchainChanged(
  changed: readonly string[],
  base: ToolchainRevision,
  head: ToolchainRevision,
  plugins: readonly string[],
): boolean | null {
  for (const file of PRETTIER_TOOLCHAIN_FILES) {
    if (!changed.includes(file)) continue;
    const [before, after] =
      file === "bun.lock"
        ? [base["bun.lock"], head["bun.lock"]]
        : [base["package.json"], head["package.json"]];
    if (before === null || after === null) return true;
    try {
      const slice =
        file === "bun.lock"
          ? (text: string) => prettierLockSlice(text, plugins)
          : prettierPackageJsonSlice;
      if (slice(before) !== slice(after)) return true;
    } catch {
      return null;
    }
  }
  return false;
}
