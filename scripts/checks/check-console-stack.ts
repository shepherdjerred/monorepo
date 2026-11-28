#!/usr/bin/env bun
/**
 * Console stack check: the ten first-party ops consoles share one stack, and
 * this check reads their `package.json` files to keep it that way.
 *
 * The standard is written down in
 * `packages/docs/wiki/src/content/docs/reference/console-stack.md`. For each
 * console (and `console-ui`, which owns the shared pieces) the check derives a
 * list of deviations: a library the standard requires that is missing, a
 * banned alternative that is present, or a catalogued library whose spec is not
 * `catalog:`. Today's deviations live in `ALLOWLIST` below, each with a reason.
 *
 * The allowlist only shrinks. A deviation that is not listed fails the check,
 * and so does a listed deviation that no longer exists: the migration PR that
 * removes a deviation removes its entry in the same change.
 */
import { z } from "zod";
import {
  ALLOWLIST,
  BANNED_GROUPS,
  CATALOG_PENDING,
  KIT_PROVIDES,
  CONSOLES,
  REQUIRED,
  RUST_BANNED,
  type AllowlistEntry,
  type ConsoleDefinition,
  type Deviation,
} from "./console-stack-rules.ts";

const PackageJsonSchema = z.object({
  name: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  catalog: z.record(z.string(), z.string()).optional(),
});

type PackageJson = z.infer<typeof PackageJsonSchema>;

/** Every dependency a package declares, with its spec. */
function declared(pkg: PackageJson): Map<string, string> {
  return new Map([
    ...Object.entries(pkg.peerDependencies ?? {}),
    ...Object.entries(pkg.devDependencies ?? {}),
    ...Object.entries(pkg.dependencies ?? {}),
  ]);
}

function isBanned(name: string): string | undefined {
  for (const group of BANNED_GROUPS) {
    for (const banned of group.names) {
      const matches = banned.endsWith("/")
        ? name.startsWith(banned)
        : name === banned;
      if (matches) return `use ${group.replaces}, not ${name}`;
    }
  }
  return undefined;
}

export function deviationsFor(
  definition: ConsoleDefinition,
  pkg: PackageJson,
  catalog: ReadonlyMap<string, string>,
): Deviation[] {
  const deps = declared(pkg);
  const provided = new Set(
    [...deps.keys()].flatMap((name) => KIT_PROVIDES[name] ?? []),
  );
  const deviations: Deviation[] = [];
  for (const library of REQUIRED[definition.kind]) {
    if (!deps.has(library) && !provided.has(library)) {
      deviations.push({
        app: definition.id,
        kind: "missing",
        library,
        rule: `the standard requires ${library}`,
      });
    }
  }
  const bannedHere =
    definition.kind === "rust-client"
      ? RUST_BANNED.map((name) => ({
          name,
          rule: `${name} cannot run against a Rust server`,
        }))
      : [];
  for (const [name, spec] of deps) {
    const rule = isBanned(name);
    if (rule !== undefined) {
      deviations.push({
        app: definition.id,
        kind: "banned",
        library: name,
        rule,
      });
    }
    const rust = bannedHere.find((entry) => entry.name === name);
    if (rust !== undefined) {
      deviations.push({
        app: definition.id,
        kind: "banned",
        library: name,
        rule: rust.rule,
      });
    }
    if (
      spec !== "catalog:" &&
      !spec.startsWith("workspace:") &&
      catalog.has(name)
    ) {
      deviations.push({
        app: definition.id,
        kind: "uncatalogued",
        library: name,
        rule: `${name} is in the root catalog; declare it as "catalog:", not "${spec}"`,
      });
    }
  }
  return deviations;
}

const keyOf = (item: { app: string; kind: string; library: string }): string =>
  `${item.app}:${item.kind}:${item.library}`;

export type StackReport = {
  readonly deviations: readonly Deviation[];
  /** Deviations with no allowlist entry. */
  readonly unlisted: readonly Deviation[];
  /** Allowlist entries whose deviation no longer exists. */
  readonly stale: readonly AllowlistEntry[];
  /** Allowlist entries that name an app or repeat another entry. */
  readonly malformed: readonly string[];
};

export function compare(
  deviations: readonly Deviation[],
  allowlist: readonly AllowlistEntry[],
  apps: readonly string[],
): StackReport {
  const present = new Set(deviations.map((item) => keyOf(item)));
  const listed = new Set(allowlist.map((item) => keyOf(item)));
  const malformed: string[] = [];
  const seen = new Set<string>();
  for (const entry of allowlist) {
    if (!apps.includes(entry.app)) {
      malformed.push(`${keyOf(entry)}: unknown app "${entry.app}"`);
    }
    if (entry.reason.trim() === "") {
      malformed.push(`${keyOf(entry)}: missing reason`);
    }
    if (seen.has(keyOf(entry))) malformed.push(`${keyOf(entry)}: duplicate`);
    seen.add(keyOf(entry));
  }
  return {
    deviations,
    unlisted: deviations.filter((item) => !listed.has(keyOf(item))),
    stale: allowlist.filter((item) => !present.has(keyOf(item))),
    malformed,
  };
}

/** A fixed-width table of deviations per app, with each one's allowlist reason. */
export function renderTable(
  deviations: readonly Deviation[],
  allowlist: readonly AllowlistEntry[],
  definitions: readonly ConsoleDefinition[] = CONSOLES,
): string {
  const reasons = new Map(allowlist.map((item) => [keyOf(item), item.reason]));
  const rows = definitions.flatMap((definition) => {
    const own = deviations.filter((item) => item.app === definition.id);
    if (own.length === 0)
      return [[definition.label, "-", "-", "on the standard"]];
    return own.map((item) => [
      definition.label,
      item.kind,
      item.library,
      reasons.get(keyOf(item)) ?? "NOT ALLOWLISTED",
    ]);
  });
  const header = ["app", "deviation", "library", "reason"];
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? cell.length))
      .join("  ")
      .trimEnd();
  return [
    line(header),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map((row) => line(row)),
  ].join("\n");
}

async function readPackage(path: string): Promise<PackageJson> {
  return PackageJsonSchema.parse(await Bun.file(path).json());
}

export async function collect(root: string): Promise<{
  deviations: Deviation[];
  catalog: ReadonlyMap<string, string>;
  problems: string[];
}> {
  const rootPackage = await readPackage(`${root}/package.json`);
  const catalog = new Map(Object.entries(rootPackage.catalog ?? {}));
  const problems: string[] = [];
  const deviations: Deviation[] = [];
  for (const definition of CONSOLES) {
    deviations.push(
      ...deviationsFor(
        definition,
        await readPackage(`${root}/${definition.directory}/package.json`),
        catalog,
      ),
    );
    if (
      definition.kind === "rust-client" &&
      !(await Bun.file(`${root}/${definition.directory}/Cargo.toml`).exists())
    ) {
      problems.push(
        `${definition.id} is declared a Rust console but ${definition.directory}/Cargo.toml does not exist`,
      );
    }
  }
  for (const library of Object.values(REQUIRED).flat()) {
    if (!catalog.has(library) && !CATALOG_PENDING.includes(library)) {
      problems.push(
        `the standard requires ${library} but the root package.json catalog does not list it; add it, or list it in CATALOG_PENDING`,
      );
    }
  }
  for (const library of CATALOG_PENDING) {
    if (catalog.has(library)) {
      problems.push(
        `${library} is in the root catalog; delete it from CATALOG_PENDING in scripts/checks/console-stack-rules.ts`,
      );
    }
  }
  return { deviations, catalog, problems };
}

if (import.meta.main) {
  const root = new URL("../..", import.meta.url).pathname;
  const { deviations, problems } = await collect(root);
  const report = compare(
    deviations,
    ALLOWLIST,
    CONSOLES.map((definition) => definition.id),
  );
  console.log(renderTable(deviations, ALLOWLIST));
  const failures = [
    ...problems,
    ...report.malformed,
    ...report.unlisted.map(
      (item) => `${keyOf(item)}: ${item.rule}, and it is not allowlisted`,
    ),
    ...report.stale.map(
      (item) =>
        `${keyOf(item)}: allowlisted but no longer a deviation; delete the entry from ALLOWLIST in scripts/checks/check-console-stack.ts`,
    ),
  ];
  console.log(
    `\n${String(deviations.length)} allowlisted deviation(s) across ${String(CONSOLES.length)} packages.`,
  );
  if (failures.length > 0) {
    console.error("\ncheck-console-stack: FAIL");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log("check-console-stack: OK");
}
