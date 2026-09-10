#!/usr/bin/env bun

/**
 * React version-sync checker — prevents the "Incompatible React versions" class
 * of runtime crash.
 *
 * React 19's `react-dom` ships a module-load-time guard that throws
 *   `Incompatible React versions: The "react" and "react-dom" packages must
 *    have the exact same version.`
 * the instant `react-dom/client` is imported when its version does not exactly
 * match the installed `react`. This is a *runtime* throw — it survives
 * `tsc`, `vite build`, eslint, and tests, and only blows up in the browser
 * (blank page). This check preserves the repository-wide fix for that failure.
 *
 * This check enforces, across every `bun.lock` in the repo, that packages which
 * must move in lockstep resolve to compatible versions. The rule only applies
 * where a workspace declares BOTH halves of a pair *directly* (a transitive
 * `react-dom`, e.g. from a React Native toolchain, is never rendered). It also
 * flags the upstream cause — a workspace declaring the pair with mismatched
 * specifier styles (one exact pin, one range), which lets the range float ahead
 * of the pin on the very first install.
 *
 * Authoritative signal is the resolved version in the lockfile (what actually
 * ships); the specifier-style check is an early warning. Both are read from the
 * `bun.lock` `workspaces` + `packages` sections — a single source of truth.
 */

import { Glob } from "bun";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const RecordSchema = z.record(z.string(), z.unknown());

/** Narrow an unknown value to a plain object map, or `undefined` if it isn't one. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  const parsed = RecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Pairs of packages that must resolve to compatible versions in a lockfile.
 * `match: "exact"` requires identical resolved versions (react/react-dom).
 * `match: "major"` requires the same major (the `@types/*` track their major).
 */
const LOCKSTEP_PAIRS: { a: string; b: string; match: "exact" | "major" }[] = [
  { a: "react", b: "react-dom", match: "exact" },
  { a: "@types/react", b: "@types/react-dom", match: "major" },
];

const EXCLUDE_GLOBS = ["**/node_modules/**", "sandbox/archive/**"];

type Violation = {
  file: string;
  message: string;
};

/**
 * `bun.lock` is JSONC (trailing commas, optionally comments), not strict JSON.
 * Strip line/block comments and trailing commas — tracking string state so we
 * never touch characters inside string literals — then `JSON.parse`.
 */
/** True when the comma at `commaIndex` is followed only by whitespace then `}`/`]`. */
function isTrailingComma(text: string, commaIndex: number): boolean {
  let j = commaIndex + 1;
  while (j < text.length && /\s/.test(text[j] ?? "")) j++;
  const after = text[j];
  return after === "}" || after === "]";
}

type StripState = {
  /** Index of the next unconsumed character. */
  index: number;
  /** Output accumulated so far. */
  out: string;
};

/**
 * If a `//` or `/*` comment starts at `state.index`, consume it whole (keeping
 * a line comment's terminating newline) and return true.
 */
function consumeComment(text: string, state: StripState): boolean {
  const ch = text[state.index];
  const next = text[state.index + 1];
  if (ch !== "/" || (next !== "/" && next !== "*")) return false;
  if (next === "/") {
    const newline = text.indexOf("\n", state.index + 2);
    if (newline === -1) {
      state.index = text.length;
    } else {
      state.out += "\n";
      state.index = newline + 1;
    }
    return true;
  }
  const close = text.indexOf("*/", state.index + 2);
  state.index = close === -1 ? text.length : close + 2;
  return true;
}

/**
 * If a string literal starts at `state.index`, consume it whole (honouring
 * `\` escapes, tolerating an unterminated literal at EOF) and return true.
 */
function consumeString(text: string, state: StripState): boolean {
  if (text[state.index] !== '"') return false;
  state.out += '"';
  state.index++;
  while (state.index < text.length) {
    const ch = text[state.index];
    state.out += ch ?? "";
    state.index++;
    if (ch === "\\") {
      state.out += text[state.index] ?? "";
      state.index++;
    } else if (ch === '"') {
      break;
    }
  }
  return true;
}

/** Consume one plain character, dropping it when it is a trailing comma. */
function consumePlain(text: string, state: StripState): void {
  const ch = text[state.index];
  if (ch !== "," || !isTrailingComma(text, state.index)) {
    state.out += ch ?? "";
  }
  state.index++;
}

function parseJsonc(text: string): unknown {
  const state: StripState = { index: 0, out: "" };
  while (state.index < text.length) {
    if (!consumeComment(text, state) && !consumeString(text, state)) {
      consumePlain(text, state);
    }
  }
  return JSON.parse(state.out);
}

/** Parse `name@version` (handles scoped names like `@types/react@19.2.14`). */
function parseNameVersion(
  id: string,
): { name: string; version: string } | null {
  const at = id.lastIndexOf("@");
  if (at <= 0) return null;
  return { name: id.slice(0, at), version: id.slice(at + 1) };
}

function major(version: string): string {
  return version.split(".")[0] ?? version;
}

/**
 * Collect every resolved version of `name` in a parsed bun.lock `packages` map.
 * A lockfile can list multiple versions of a package (hoisted + nested), so we
 * return a set.
 */
function resolvedVersions(
  packages: Record<string, unknown>,
  name: string,
): Set<string> {
  const versions = new Set<string>();
  for (const entry of Object.values(packages)) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    const parsed = parseNameVersion(entry[0]);
    if (parsed?.name !== name) continue;
    // Skip workspace self-links (`name@workspace:...`) and other non-semver tags.
    if (!/^\d/.test(parsed.version)) continue;
    versions.add(parsed.version);
  }
  return versions;
}

function isRange(spec: string): boolean {
  // Anything that is not a bare exact semver (e.g. starts with ^ ~ >= < * x).
  return !/^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i.test(spec);
}

/** Merge a workspace's direct `dependencies` + `devDependencies` into one map. */
function workspaceDeps(workspace: unknown): Record<string, string> {
  const ws = asRecord(workspace);
  if (ws === undefined) return {};
  const deps: Record<string, unknown> = asRecord(ws["dependencies"]) ?? {};
  const dev: Record<string, unknown> = asRecord(ws["devDependencies"]) ?? {};
  const merged: Record<string, string> = {};
  for (const [name, spec] of [
    ...Object.entries(deps),
    ...Object.entries(dev),
  ]) {
    if (typeof spec === "string") merged[name] = spec;
  }
  return merged;
}

async function checkLockfile(file: string): Promise<Violation[]> {
  const violations: Violation[] = [];
  let parsed: unknown;
  try {
    parsed = parseJsonc(await readFile(file, "utf8"));
  } catch (error) {
    return [{ file, message: `failed to parse lockfile: ${String(error)}` }];
  }
  const root: Record<string, unknown> = asRecord(parsed) ?? {};
  const packages: Record<string, unknown> = asRecord(root["packages"]) ?? {};
  const workspaces: Record<string, unknown> =
    asRecord(root["workspaces"]) ?? {};

  // Per-workspace direct declarations — the lockstep rule only applies when a
  // workspace declares BOTH halves of a pair directly. A transitive `react-dom`
  // (e.g. pulled in by a React Native toolchain) is never rendered and must not
  // be flagged.
  const declarations = Object.entries(workspaces).map(([path, ws]) => ({
    path: path === "" ? "." : path,
    deps: workspaceDeps(ws),
  }));

  for (const pair of LOCKSTEP_PAIRS) {
    const declaringBoth = declarations.filter(
      ({ deps }) => deps[pair.a] !== undefined && deps[pair.b] !== undefined,
    );
    if (declaringBoth.length === 0) continue;

    // (1) Early warning: mismatched specifier styles in the declaration let the
    // range float ahead of the pin on the very first install.
    for (const { path, deps } of declaringBoth) {
      const aSpec = deps[pair.a];
      const bSpec = deps[pair.b];
      if (aSpec === undefined || bSpec === undefined) continue;
      if (isRange(aSpec) !== isRange(bSpec)) {
        violations.push({
          file,
          message: `[${path}] ${pair.a} ("${aSpec}") and ${pair.b} ("${bSpec}") use mismatched specifier styles (one exact pin, one range). Pin both exactly to the same version, or use the same range for both.`,
        });
      }
    }

    // (2) Authoritative: the resolved versions that actually ship.
    const aVersions = resolvedVersions(packages, pair.a);
    const bVersions = resolvedVersions(packages, pair.b);
    if (aVersions.size === 0 || bVersions.size === 0) continue;

    if (pair.match === "exact") {
      // Subset semantics: every pair.b version must have a matching pair.a version.
      // A bare pair.a with no pair.b (e.g. React Native) is fine.
      const missing = [...bVersions].filter((v) => !aVersions.has(v));
      if (missing.length > 0) {
        violations.push({
          file,
          message: `${pair.b} (${missing.join(", ")}) has no matching ${pair.a} version (${pair.a} resolves to: ${[...aVersions].sort().join(", ")}) — React throws "Incompatible React versions" at runtime. Run \`bun install\` after aligning the pins.`,
        });
      }
    } else {
      const aMajors = new Set([...aVersions].map((v) => major(v)));
      const bMajors = new Set([...bVersions].map((v) => major(v)));
      // Subset semantics: every pair.b major must have a matching pair.a major.
      const missingMajors = [...bMajors].filter((m) => !aMajors.has(m));
      if (missingMajors.length > 0) {
        violations.push({
          file,
          message: `${pair.b} major(s) (${missingMajors.join(", ")}) have no matching ${pair.a} major (${pair.a} resolves to major(s): ${[...aMajors].sort().join(", ")}).`,
        });
      }
    }
  }
  return violations;
}

async function collect(pattern: string): Promise<string[]> {
  const glob = new Glob(pattern);
  const files: string[] = [];
  for await (const file of glob.scan({ dot: false })) {
    if (EXCLUDE_GLOBS.some((ex) => new Glob(ex).match(file))) continue;
    files.push(file);
  }
  return files.sort();
}

async function main(): Promise<void> {
  const lockfiles = await collect("**/bun.lock");

  const results = await Promise.all(lockfiles.map((f) => checkLockfile(f)));
  const violations = results.flat();

  if (violations.length > 0) {
    console.error("React version-sync violations:\n");
    for (const v of violations) {
      console.error(`  ${v.file}`);
      console.error(`    ${v.message}\n`);
    }
    console.error(
      `${String(violations.length)} violation(s) found across ${String(lockfiles.length)} lockfile(s).`,
    );
    process.exit(1);
  }

  console.log(
    `No React version-sync violations (${String(lockfiles.length)} lockfiles checked).`,
  );
}

await main();
