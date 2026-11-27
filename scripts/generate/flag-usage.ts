/**
 * Static index of where each managed feature flag is read in code.
 *
 * The Flags operator UI shows a "Read by" panel per flag. A typed pass over
 * the whole repository is too slow for a CI freshness check, so this index is
 * built syntactically: every in-scope TypeScript file is parsed with
 * `ts.createSourceFile` (no Program, no type checker) and every in-scope Java
 * file under The Storm's `src/main` is tokenized for string literals.
 *
 * A TypeScript hit is a string literal exactly equal to a managed key in one
 * of the positions consumers use to name a flag:
 *
 * - `config-flag-name` — the value of `flag:` inside a `names: { … }` object
 *   (`defineConfig` overrides);
 * - `config-derived` — a config definition property whose `sources` array
 *   contains `"flag"` with no explicit `names.flag`, mapped through
 *   `deriveKeyNames` exactly as `@shepherdjerred/config` derives it;
 * - `call-argument` — `isEnabled("…")`, `flagValueSchema("…")`, typed
 *   wrappers such as streambot `enabled("…")` or scout `getFlag("…")`;
 * - `array-element` — key lists such as `["…", "…"] as const`;
 * - `constant` — a named key such as `const FLAG_KEY = "…"` or a class field,
 *   which the file then passes to one of the readers above.
 *
 * Literal types (`"a" | "b"`, `satisfies Record<"a", …>`, type arguments) are
 * declarations of the key space, not reads, and are skipped. Tests, fixtures,
 * generated output, `dist/`, `node_modules/` and `sandbox/` are skipped.
 *
 * Short keys collide with unrelated literals (scout's `debug` matches dozens
 * of log-level strings repo-wide), so a hit for key K counts only in a file
 * under one of the package roots that `flag-usage-scopes.json` allows for K's
 * inventory namespace. Every inventory namespace must have a scope entry.
 *
 * The output carries no line numbers: an edit above a read would otherwise
 * make the committed file stale.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import prettier from "prettier";
import { z } from "zod";

import { managedFlagInventory } from "../../packages/feature-flags/src/managed-flag-inventory.ts";
import { run } from "../lib/run.ts";
import {
  extractJavaHits,
  extractTypeScriptHits,
  FlagUsageKindSchema,
  isScannedPath,
} from "./flag-usage-extract.ts";
import scopesJson from "./flag-usage-scopes.json" with { type: "json" };

export const REPOSITORY_ROOT = path.resolve(import.meta.dir, "..", "..");
export const OUTPUT_PATH = "packages/flags/src/flag-usage.generated.json";
export const SCOPES_PATH = "scripts/generate/flag-usage-scopes.json";
export const REGENERATE_COMMAND = "bun run generate-flag-usage";

export const FlagUsageEntrySchema = z.strictObject({
  package: z.string().min(1),
  file: z.string().min(1),
  kind: FlagUsageKindSchema,
  count: z.number().int().positive(),
});
export type FlagUsageEntry = z.infer<typeof FlagUsageEntrySchema>;

export const FlagUsageIndexSchema = z.strictObject({
  version: z.literal(1),
  flags: z.record(z.string(), z.array(FlagUsageEntrySchema)),
  unreferenced: z.array(z.string()),
});
export type FlagUsageIndex = z.infer<typeof FlagUsageIndexSchema>;

export const FlagUsageScopesSchema = z.record(
  z.string().min(1),
  z.array(z.string().regex(/^packages\/[^/]+(?:\/[^/]+)*$/u)).min(1),
);
export type FlagUsageScopes = z.infer<typeof FlagUsageScopesSchema>;

export type ManagedFlagRef = {
  readonly key: string;
  readonly namespace: string;
};

export type ScannedFile = {
  /** Repository-relative, forward-slash path. */
  readonly file: string;
  /** Name of the nearest enclosing `package.json`. */
  readonly package: string;
  readonly text: string;
};

/** Every inventory namespace needs a scope; every scope needs a namespace. */
export function scopeErrors(
  namespaces: readonly string[],
  scopes: FlagUsageScopes,
): string[] {
  const known = new Set(namespaces);
  const errors: string[] = [];
  for (const namespace of namespaces) {
    if (scopes[namespace] === undefined) {
      errors.push(
        `inventory namespace "${namespace}" has no entry in ${SCOPES_PATH}`,
      );
    }
  }
  for (const namespace of Object.keys(scopes)) {
    if (!known.has(namespace)) {
      errors.push(
        `${SCOPES_PATH} scopes "${namespace}", which is not an inventory namespace`,
      );
    }
  }
  return errors;
}

function isUnderRoot(file: string, root: string): boolean {
  return file === root || file.startsWith(`${root}/`);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** Build the index from already-read files. Pure and deterministic. */
export function buildFlagUsageIndex(
  flags: readonly ManagedFlagRef[],
  scopes: FlagUsageScopes,
  files: readonly ScannedFile[],
): FlagUsageIndex {
  const unscoped = flags.filter((flag) => scopes[flag.namespace] === undefined);
  if (unscoped.length > 0) {
    throw new Error(
      unscoped
        .map(
          (flag) =>
            `flag "${flag.key}" namespace "${flag.namespace}" has no entry in ${SCOPES_PATH}`,
        )
        .join("\n"),
    );
  }

  const counts = new Map<string, Map<string, FlagUsageEntry>>();
  for (const scanned of files) {
    if (!isScannedPath(scanned.file)) continue;
    const keys = new Set(
      flags
        .filter((flag) =>
          (scopes[flag.namespace] ?? []).some((root) =>
            isUnderRoot(scanned.file, root),
          ),
        )
        .map((flag) => flag.key),
    );
    if (keys.size === 0) continue;
    const hits = scanned.file.endsWith(".java")
      ? extractJavaHits(scanned.text, keys)
      : extractTypeScriptHits(scanned.text, scanned.file, keys);
    for (const hit of hits) {
      const entries = counts.get(hit.key) ?? new Map<string, FlagUsageEntry>();
      counts.set(hit.key, entries);
      const id = `${scanned.file}\0${hit.kind}`;
      const existing = entries.get(id);
      entries.set(id, {
        package: scanned.package,
        file: scanned.file,
        kind: hit.kind,
        count: (existing?.count ?? 0) + 1,
      });
    }
  }

  const sortedKeys = flags.map((flag) => flag.key).toSorted(compareText);
  return {
    version: 1,
    flags: Object.fromEntries(
      sortedKeys.flatMap((key) => {
        const entries = counts.get(key);
        if (entries === undefined) return [];
        return [
          [
            key,
            [...entries.values()].toSorted(
              (left, right) =>
                compareText(left.file, right.file) ||
                compareText(left.kind, right.kind),
            ),
          ],
        ];
      }),
    ),
    unreferenced: sortedKeys.filter((key) => !counts.has(key)),
  };
}

export function loadScopes(): FlagUsageScopes {
  return FlagUsageScopesSchema.parse(scopesJson);
}

const PackageNameSchema = z.object({ name: z.string().min(1) });

function packageResolver(root: string): (file: string) => Promise<string> {
  const cache = new Map<string, Promise<string>>();
  const resolveDirectory = (directory: string): Promise<string> => {
    const cached = cache.get(directory);
    if (cached !== undefined) return cached;
    const pending = (async () => {
      const manifest = Bun.file(path.join(root, directory, "package.json"));
      if (await manifest.exists()) {
        const parsed = PackageNameSchema.safeParse(await manifest.json());
        if (parsed.success) return parsed.data.name;
      }
      const parent = path.posix.dirname(directory);
      if (parent === directory) {
        throw new Error(`no named package.json encloses ${directory}`);
      }
      return resolveDirectory(parent);
    })();
    cache.set(directory, pending);
    return pending;
  };
  return (file) => resolveDirectory(path.posix.dirname(file));
}

async function listCandidateFiles(
  root: string,
  scopeRoots: readonly string[],
): Promise<string[]> {
  const result = await run(
    [
      "git",
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...scopeRoots,
    ],
    { capture: true, secret: true, cwd: root },
  );
  const listed = [
    ...new Set(result.stdout.split("\0").filter((file) => file !== "")),
  ].filter((file) => isScannedPath(file));
  const existing = await Promise.all(
    listed.map(async (file) => ({
      file,
      exists: await Bun.file(path.join(root, file)).exists(),
    })),
  );
  return existing
    .filter(({ exists }) => exists)
    .map(({ file }) => file)
    .toSorted(compareText);
}

/** Read the repository and build the index the committed file must equal. */
export async function collectFlagUsageIndex(
  root: string = REPOSITORY_ROOT,
): Promise<FlagUsageIndex> {
  const scopes = loadScopes();
  const errors = scopeErrors(
    managedFlagInventory.namespaces.map((namespace) => namespace.key),
    scopes,
  );
  const scopeRoots = [...new Set(Object.values(scopes).flat())].toSorted(
    compareText,
  );
  for (const scopeRoot of scopeRoots) {
    const exists = await readdir(path.join(root, scopeRoot)).then(
      () => true,
      () => false,
    );
    if (!exists) {
      errors.push(`${SCOPES_PATH} root ${scopeRoot} is not a directory`);
    }
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));

  const resolvePackage = packageResolver(root);
  const candidates = await listCandidateFiles(root, scopeRoots);
  const files = await Promise.all(
    candidates.map(async (file) => ({
      file,
      package: await resolvePackage(file),
      text: await Bun.file(path.join(root, file)).text(),
    })),
  );
  return buildFlagUsageIndex(managedFlagInventory.flags, scopes, files);
}

/** The exact committed text: prettier-formatted JSON with a final newline. */
export async function renderFlagUsageIndex(
  index: FlagUsageIndex,
  root: string = REPOSITORY_ROOT,
): Promise<string> {
  const outputFile = path.join(root, OUTPUT_PATH);
  const options = (await prettier.resolveConfig(outputFile)) ?? {};
  return prettier.format(JSON.stringify(index), {
    ...options,
    filepath: outputFile,
  });
}

if (import.meta.main) {
  const index = await collectFlagUsageIndex();
  await Bun.write(
    path.join(REPOSITORY_ROOT, OUTPUT_PATH),
    await renderFlagUsageIndex(index),
  );
  const referenced = Object.keys(index.flags).length;
  console.log(
    `Wrote ${OUTPUT_PATH}: ${referenced.toString()} referenced, ${index.unreferenced.length.toString()} unreferenced`,
  );
}
