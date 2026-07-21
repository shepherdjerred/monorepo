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

const GLOBAL_IMAGE_INPUTS = [
  ".buildkite/",
  ".dockerignore",
  ".mise.toml",
  "docker-bake.hcl",
  "bun.lock",
  "bunfig.toml",
  "package.json",
  "patches/",
  "turbo.json",
  "tsconfig.base.json",
];

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

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix;
}

export async function selectImageTargets(
  changedPaths: readonly string[],
  repoRoot = process.cwd(),
): Promise<string[]> {
  if (
    changedPaths.some(
      (path) =>
        path.endsWith("/package.json") ||
        GLOBAL_IMAGE_INPUTS.some((prefix) => pathMatchesPrefix(path, prefix)),
    )
  ) {
    return ALL_IMAGE_TARGETS;
  }

  const packages = await loadWorkspaces(repoRoot);
  const selected = new Set<string>();

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
    if (changedPaths.some((path) => dirs.some((dir) => path.startsWith(dir)))) {
      selected.add(target);
    }
  }

  for (const [target, prefixes] of Object.entries(TARGET_PATH_PREFIXES)) {
    if (
      changedPaths.some((path) =>
        prefixes.some((prefix) => pathMatchesPrefix(path, prefix)),
      )
    ) {
      selected.add(target);
    }
  }

  return [...selected].sort();
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

async function main(): Promise<void> {
  const baseFlag = Bun.argv.indexOf("--base");
  const base = baseFlag === -1 ? undefined : Bun.argv[baseFlag + 1];
  if (base === undefined || base === "") {
    console.error("Usage: select-image-targets.ts --base <git-ref>");
    process.exit(2);
  }
  console.log(
    JSON.stringify(await selectImageTargets(await changedPathsSince(base))),
  );
}

if (import.meta.main) {
  await main();
}
