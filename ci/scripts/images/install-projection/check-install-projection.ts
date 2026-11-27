#!/usr/bin/env bun

/**
 * Check every Dockerfile install projection (install-projection.ts) against
 * Bun itself. The set is every packages/** Dockerfile whose manifests stage
 * runs workspace-manifests.ts, so non-application stages (the game images'
 * arcade contexts) are covered too.
 *
 *   frozen  `//#check-image-install-projection`, default tier. Projections are
 *           byte-deterministic, printLockfile reproduces bun.lock, and every
 *           install command each Dockerfile runs accepts its projection under
 *           `--frozen-lockfile --dry-run`: the projection is sufficient.
 *   drift   `//#test:extended`, extended tier (about seven minutes). Runs each
 *           install command for real (`--ignore-scripts`) from today's full
 *           root files and from the projection, and fails on drift
 *           (install-drift.ts) or on an optional-peer change that
 *           optional-peer-baseline.json does not list: the projection is exact.
 *
 * Usage: bun check-install-projection.ts frozen|drift [--report <file.json>]
 */

import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isRecord,
  parseJsonc,
} from "../../selectors/select-image-targets-lockfile.ts";
import { loadWorkspaces } from "../../selectors/select-image-targets-workspaces.ts";
import {
  compareInstalls,
  type InstallSnapshot,
  type OptionalPeerBaselineEntry,
  type OptionalPeerChange,
  type OptionalPeerLookup,
  optionalPeerKey,
  type StoreEntry,
  storeEntryId,
  unbaselinedOptionalPeers,
} from "./install-drift.ts";
import { printLockfile, projectInstallInputs } from "./install-projection.ts";
import {
  closureManifestPaths,
  writeClosureManifests,
} from "../workspace-manifests.ts";

const repoRoot = path.resolve(import.meta.dir, "../../../..");

/** The whitespace-separated, single-quote-stripped words of a command line. */
function commandWords(line: string): string[] {
  return line
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) => unquote(word));
}

function installedIds(installed: InstallSnapshot): number {
  return new Set([...installed.entries.values()].map((node) => node.id)).size;
}

type ImageInstall = {
  readonly dockerfile: string;
  readonly filters: readonly string[];
  /** Each `bun install` argument list the Dockerfile runs. */
  readonly installs: readonly (readonly string[])[];
};

const unquote = (word: string) => word.replace(/^'(.*)'$/, "$1");

/** Every Dockerfile that installs from a projection, with its installs. */
export async function projectedImageInstalls(
  root: string,
): Promise<ImageInstall[]> {
  const dockerfiles = await Array.fromAsync(
    new Bun.Glob("packages/**/Dockerfile").scan({ cwd: root }),
  );
  const images: ImageInstall[] = [];
  for (const dockerfile of dockerfiles
    .filter((file) => !file.includes("/node_modules/"))
    .sort()) {
    const source = await Bun.file(path.join(root, dockerfile)).text();
    const text = source.replaceAll("\\\n", " ");
    const projection =
      /workspace-manifests\.ts \/workspace \/closure ([^\n]+)/.exec(text)?.[1];
    if (projection === undefined) continue;
    if (!/^RUN bun install /m.test(text)) {
      throw new Error(`${dockerfile} projects a closure but never installs it`);
    }
    images.push({
      dockerfile,
      filters: commandWords(projection),
      installs: [...text.matchAll(/^RUN bun install ([^\n]+)/gm)].map((match) =>
        commandWords(match[1] ?? ""),
      ),
    });
  }
  return images;
}

async function copyRelative(from: string, to: string, file: string) {
  await mkdir(path.dirname(path.join(to, file)), { recursive: true });
  await cp(path.join(from, file), path.join(to, file), { recursive: true });
}

/** Stage today's full root install inputs and the projection side by side. */
async function stage(image: ImageInstall, base: string) {
  const full = path.join(base, "full");
  const projected = path.join(base, "projected");
  const manifests = closureManifestPaths(
    image.filters,
    await loadWorkspaces(repoRoot),
  );
  for (const file of [...manifests, "bun.lock", "bunfig.toml", "patches"]) {
    await copyRelative(repoRoot, full, file);
  }
  await writeClosureManifests(repoRoot, projected, image.filters);
  await copyRelative(repoRoot, projected, "bunfig.toml");
  const dirs = manifests
    .filter((file) => file !== "package.json")
    .map((file) => path.dirname(file));
  return { full, projected, dirs };
}

function bunInstall(cwd: string, args: readonly string[]): string | null {
  const result = Bun.spawnSync(["bun", "install", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode === 0) return null;
  const output = `${result.stderr.toString()}${result.stdout.toString()}`;
  return output
    .split("\n")
    .filter((line) => /error|note/.test(line))
    .join(" | ");
}

async function symlinks(dir: string): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    // A workspace the filtered install did not link has no node_modules.
    return links;
  }
  for (const name of names) {
    if (name === ".bin" || name === ".bun") continue;
    const full = path.join(dir, name);
    if (name.startsWith("@")) {
      for (const [scoped, target] of await symlinks(full)) {
        links.set(`${name}/${scoped}`, target);
      }
    } else {
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) links.set(name, await readlink(full));
    }
  }
  return links;
}

/** `../../zod@4.1.0/node_modules/zod` -> `zod@4.1.0`; other links -> workspace. */
function linkTarget(target: string): string {
  const entry = /(?:^|\/)([^/]+)\/node_modules\/(?:@[^/]+\/)?[^/]+$/.exec(
    target,
  );
  return entry?.[1] ?? `workspace:${target}`;
}

async function snapshot(
  root: string,
  dirs: readonly string[],
): Promise<InstallSnapshot> {
  const store = path.join(root, "node_modules/.bun");
  const entries = new Map<string, StoreEntry>();
  for (const entry of await readdir(store)) {
    if (entry === "node_modules") continue;
    const links = new Map<string, string>();
    for (const [name, target] of await symlinks(
      path.join(store, entry, "node_modules"),
    )) {
      links.set(name, linkTarget(target));
    }
    entries.set(entry, { id: storeEntryId(entry), links });
  }
  const roots = new Map<string, ReadonlyMap<string, string>>();
  for (const dir of dirs) {
    const links = new Map<string, string>();
    for (const [name, target] of await symlinks(
      path.join(root, dir, "node_modules"),
    )) {
      links.set(name, linkTarget(target));
    }
    if (links.size > 0) roots.set(dir, links);
  }
  return { entries, roots };
}

/** Optional peers from bun.lock package metadata and workspace manifests. */
async function optionalPeers(root: string): Promise<OptionalPeerLookup> {
  const lock = parseJsonc(await Bun.file(path.join(root, "bun.lock")).text());
  const byId = new Map<string, Set<string>>();
  const packages = isRecord(lock) ? lock["packages"] : undefined;
  for (const entry of Object.values(isRecord(packages) ? packages : {})) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    const meta: unknown = entry.find((item) => isRecord(item));
    const peers = isRecord(meta) ? meta["optionalPeers"] : undefined;
    if (Array.isArray(peers)) {
      byId.set(
        entry[0],
        new Set(peers.filter((peer) => typeof peer === "string")),
      );
    }
  }
  const workspaces = await loadWorkspaces(root);
  for (const workspace of workspaces.values()) {
    const manifest: unknown = JSON.parse(
      await Bun.file(path.join(root, workspace.dir, "package.json")).text(),
    );
    const meta = isRecord(manifest)
      ? manifest["peerDependenciesMeta"]
      : undefined;
    const optional = Object.entries(isRecord(meta) ? meta : {})
      .filter(([, value]) => isRecord(value) && value["optional"] === true)
      .map(([name]) => name);
    byId.set(
      `workspace:${workspace.dir.replace(/\/$/, "")}`,
      new Set(optional),
    );
  }
  return (id, dependency) => byId.get(id)?.has(dependency) ?? false;
}

async function clearInstall(root: string, dirs: readonly string[]) {
  for (const dir of ["", ...dirs]) {
    await rm(path.join(root, dir, "node_modules"), {
      recursive: true,
      force: true,
    });
  }
}

async function checkFrozen(images: readonly ImageInstall[]): Promise<string[]> {
  const failures: string[] = [];
  const lockfile = await Bun.file(path.join(repoRoot, "bun.lock")).text();
  const parsed = parseJsonc(lockfile);
  if (!isRecord(parsed) || printLockfile(parsed) !== lockfile) {
    failures.push("printLockfile does not reproduce bun.lock byte for byte");
  }
  const rootManifest = await Bun.file(
    path.join(repoRoot, "package.json"),
  ).text();
  for (const image of images) {
    const base = await mkdtemp(path.join(tmpdir(), "install-projection-"));
    try {
      const { projected, dirs } = await stage(image, base);
      const again = projectInstallInputs({
        rootManifest,
        lockfile,
        workspaceDirs: dirs,
      });
      const written = await Bun.file(path.join(projected, "bun.lock")).text();
      const manifest = await Bun.file(
        path.join(projected, "package.json"),
      ).text();
      if (again.lockfile !== written || again.manifest !== manifest) {
        failures.push(`${image.dockerfile}: projection is not deterministic`);
      }
      for (const args of image.installs) {
        const error = bunInstall(projected, [...args, "--dry-run"]);
        const label = `${image.dockerfile} [${args.join(" ")}]`;
        console.log(`${error === null ? "ok  " : "FAIL"} ${label}`);
        if (error !== null) failures.push(`${label}: ${error}`);
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }
  return failures;
}

const BASELINE_FILE = path.join(import.meta.dir, "optional-peer-baseline.json");

function baselineString(entry: Record<string, unknown>, field: string): string {
  const value = entry[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`optional-peer baseline entry needs a ${field}`);
  }
  return value;
}

/** The audited optional-peer changes, validated so every entry has a reason. */
async function loadBaseline(): Promise<OptionalPeerBaselineEntry[]> {
  const raw: unknown = JSON.parse(await Bun.file(BASELINE_FILE).text());
  const entries = isRecord(raw) ? raw["entries"] : undefined;
  if (!Array.isArray(entries)) {
    throw new TypeError("optional-peer baseline must hold an entries array");
  }
  return entries.map((entry: unknown) => {
    if (!isRecord(entry))
      throw new TypeError("baseline entry must be an object");
    const change = baselineString(entry, "change");
    if (change !== "drop" && change !== "rebind") {
      throw new Error(`baseline change must be drop or rebind: ${change}`);
    }
    const installs = entry["installs"];
    if (
      !Array.isArray(installs) ||
      installs.length === 0 ||
      !installs.every((install) => typeof install === "string")
    ) {
      throw new TypeError("baseline entry must list its installs");
    }
    return {
      dependent: baselineString(entry, "dependent"),
      peer: baselineString(entry, "peer"),
      change,
      reason: baselineString(entry, "reason"),
      installs,
    };
  });
}

/** Allocated KiB of an install's node_modules trees. */
function installKiB(root: string, dirs: readonly string[]): number {
  const trees = ["", ...dirs].map((dir) =>
    path.join(root, dir, "node_modules"),
  );
  const result = Bun.spawnSync(["du", "-sk", ...trees], { stderr: "ignore" });
  return result.stdout
    .toString()
    .split("\n")
    .reduce((total, line) => total + (Number.parseInt(line, 10) || 0), 0);
}

type DriftRow = {
  image: string;
  /** `<Dockerfile dir> <bun install args>`: the baseline's install key. */
  install: string;
  today: number;
  projected: number;
  todayKiB: number;
  projectedKiB: number;
  removed: number;
  added: string;
  optionalPeerChanges: readonly OptionalPeerChange[];
  violations: readonly string[];
};

async function driftRow(
  image: ImageInstall,
  args: readonly string[],
  staged: { full: string; projected: string; dirs: readonly string[] },
  context: {
    optional: OptionalPeerLookup;
    baseline: readonly OptionalPeerBaselineEntry[];
  },
): Promise<DriftRow> {
  const { full, projected, dirs } = staged;
  const install = [
    path.dirname(image.dockerfile),
    ...args.filter((arg) => arg !== "--frozen-lockfile"),
  ].join(" ");
  await clearInstall(full, dirs);
  await clearInstall(projected, dirs);
  const errors = [
    bunInstall(full, [...args, "--ignore-scripts"]),
    bunInstall(projected, [...args, "--ignore-scripts"]),
  ].filter((error) => error !== null);
  const empty = { today: 0, projected: 0, todayKiB: 0, projectedKiB: 0 };
  if (errors.length > 0) {
    return {
      image: image.dockerfile,
      install,
      ...empty,
      removed: 0,
      added: "",
      optionalPeerChanges: [],
      violations: errors,
    };
  }
  const today = await snapshot(full, dirs);
  const after = await snapshot(projected, dirs);
  const report = compareInstalls(today, after, context.optional);
  return {
    image: path.dirname(image.dockerfile),
    install,
    today: installedIds(today),
    projected: installedIds(after),
    todayKiB: installKiB(full, dirs),
    projectedKiB: installKiB(projected, dirs),
    removed: report.removed.length,
    added: report.added.join(" "),
    optionalPeerChanges: report.optionalPeerChanges,
    violations: [
      ...report.violations,
      ...unbaselinedOptionalPeers(
        install,
        report.optionalPeerChanges,
        context.baseline,
      ),
    ],
  };
}

async function checkDrift(
  images: readonly ImageInstall[],
): Promise<DriftRow[]> {
  const context = {
    optional: await optionalPeers(repoRoot),
    baseline: await loadBaseline(),
  };
  const rows: DriftRow[] = [];
  for (const image of images) {
    const base = await mkdtemp(path.join(tmpdir(), "install-drift-"));
    try {
      const staged = await stage(image, base);
      for (const args of image.installs) {
        const row = await driftRow(image, args, staged, context);
        rows.push(row);
        console.log(
          `${row.violations.length === 0 ? "ok  " : "FAIL"} ${row.install}: today ${String(row.today)}, projected ${String(row.projected)}, removed ${String(row.removed)}, added ${row.added || "-"}, optional peers ${String(row.optionalPeerChanges.length)}`,
        );
        for (const violation of row.violations) {
          console.log(`     ${violation}`);
        }
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }
  return rows;
}

/** Baseline pairs no install observed; platform-specific, so a warning only. */
async function staleBaseline(rows: readonly DriftRow[]): Promise<string[]> {
  const observed = new Set(
    rows.flatMap((row) =>
      row.optionalPeerChanges.map(
        (change) => `${row.install}|${optionalPeerKey(change)}`,
      ),
    ),
  );
  const baseline = await loadBaseline();
  return baseline.flatMap((entry) =>
    entry.installs
      .filter(
        (install) => !observed.has(`${install}|${optionalPeerKey(entry)}`),
      )
      .map((install) => `${install}: ${optionalPeerKey(entry)}`),
  );
}

if (import.meta.main) {
  const [mode, flag, reportPath] = Bun.argv.slice(2);
  const images = await projectedImageInstalls(repoRoot);
  if (mode === "frozen") {
    const failures = await checkFrozen(images);
    for (const failure of failures) console.error(`FAIL ${failure}`);
    console.log(
      `install projection: ${String(images.length)} Dockerfiles, ${String(failures.length)} failures`,
    );
    process.exitCode = failures.length === 0 ? 0 : 1;
  } else if (mode === "drift") {
    const rows = await checkDrift(images);
    if (flag === "--report" && reportPath !== undefined) {
      await Bun.write(reportPath, `${JSON.stringify(rows, null, 2)}\n`);
    }
    for (const stale of await staleBaseline(rows)) {
      console.log(
        `note: baseline entry not observed on this platform: ${stale}`,
      );
    }
    const failing = rows.filter((row) => row.violations.length > 0).length;
    console.log(
      `install drift: ${String(rows.length)} installs, ${String(failing)} failing`,
    );
    process.exitCode = failing === 0 ? 0 : 1;
  } else {
    throw new Error(
      "usage: check-install-projection.ts frozen|drift [--report <file.json>]",
    );
  }
}
