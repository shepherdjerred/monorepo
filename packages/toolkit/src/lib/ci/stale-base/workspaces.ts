import path from "node:path";
import { z } from "zod";

export type WorkspaceNode = {
  readonly name: string;
  readonly dir: string;
  readonly workspaceDependencies: readonly string[];
};

export type WorkspaceGraph = {
  readonly repoRoot: string;
  readonly packages: ReadonlyMap<string, WorkspaceNode>;
  /** Sorted by descending directory path length so nested workspaces win. */
  readonly sortedDirs: readonly {
    readonly dir: string;
    readonly name: string;
  }[];
  /** Direct reverse edges: dependency name -> workspaces declaring workspace:* on it. */
  readonly reverseEdges: ReadonlyMap<string, ReadonlySet<string>>;
};

const RootManifestSchema = z.object({
  workspaces: z.array(z.string()),
});

const DepsRecordSchema = z.record(z.string(), z.unknown()).optional();

const WorkspaceManifestSchema = z.object({
  name: z.string().min(1),
  dependencies: DepsRecordSchema,
  devDependencies: DepsRecordSchema,
  optionalDependencies: DepsRecordSchema,
  peerDependencies: DepsRecordSchema,
});

const ROOT_SCRIPTS_PACKAGE = "@shepherdjerred/root-scripts";

const EXACT_GLOBAL_ROOT_INPUTS = new Set([
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "turbo.json",
  ".mise.toml",
  "mise.lock",
  "global.json",
  "tsconfig.base.json",
  "vitest.config.ts",
  "knip.json",
  ".quality-baseline.json",
]);

const GLOBAL_ROOT_PREFIXES = ["patches/", "ci/", "scripts/"] as const;

export const SYNTHESIS_WORKSPACES = new Set([
  "homelab",
  "@homelab/cdk8s",
  "@homelab/cdktn",
  "@shepherdjerred/delivery",
  "@shepherdjerred/ops-model",
  "@shepherdjerred/version-catalog",
  "@shepherdjerred/feature-flags",
]);

/**
 * Cross-workspace files read directly by `@shepherdjerred/root-scripts` tests
 * (mirrors `ROOT_SCRIPTS_EXTERNAL_INPUTS` in `scripts/verify.ts`).
 */
export const ROOT_SCRIPTS_EXTERNAL_INPUTS = [
  "packages/version-catalog/src/catalog.json",
  "packages/tasks-for-obsidian/ios/ci_scripts/",
  "packages/dotfiles/dot_local/bin/executable_cf",
  "packages/discord-plays-pokemon/Dockerfile",
  "packages/streambot/Dockerfile",
  "packages/homelab/src/talos/liskov/patches/image.yaml",
  "packages/homelab/src/talos/torvalds/patches/image.yaml",
  "packages/discord-plays-pokemon/wasm-src/upstream.json",
  "packages/discord-plays-mario-kart/Dockerfile",
  "packages/homelab/images/redlib/Dockerfile",
  "ci/ci-playwright/Dockerfile",
  "packages/windows-cross-compiler/",
  "packages/macos-cross-compiler/",
  ".mise.toml",
  "global.json",
  "docker-bake.hcl",
  "ci/application-image-smoke.Dockerfile",
  "packages/scout-for-lol/packages/backend/Dockerfile",
  "packages/homelab/src/cdk8s/src/resources/woodpecker/bun-cache-gc.sh",
  "packages/homelab/mac-ci/bootstrap.sh",
  "packages/homelab/mac-ci/provision-host.sh",
  "packages/feature-flags/src/managed-flag-inventory.ts",
  "packages/feature-flags/src/flags-drift.ts",
  "packages/feature-flags/src/flags-reconcile.ts",
  "packages/feature-flags/src/managed-flag-inventory.json",
  "packages/temporal/Dockerfile",
  "packages/media/Dockerfile",
  "packages/delivery/Dockerfile",
  "packages/fonts/patch-berkeley-mono.py",
  "packages/toolkit/src/lib/brim/capture/engine.ts",
  "packages/the-storm/plugin/gradle/libs.versions.toml",
  "packages/the-storm/server/plugins.json",
  "packages/the-storm/tests/e2e/harness/pins.ts",
  "packages/mc-harness/src/pins.ts",
  "packages/the-storm/plugin/dist/build.gradle.kts",
  "packages/the-storm/plugin/settings.gradle.kts",
  "packages/woodpecker-config-extension/src/pipeline/lanes/storm-e2e.ts",
  "packages/media/scripts/subtitle-requirements.txt",
] as const;

/**
 * Undeclared cross-workspace edges from `scripts/verify.ts` and
 * `ci/scripts/selectors/select-image-targets*.ts` (embedded image owners and
 * copied contracts that are not declared as `workspace:*` in `package.json`).
 */
const EXTRA_WORKSPACE_REVERSE_EDGES: Readonly<
  Record<string, readonly string[]>
> = {
  "@shepherdjerred/toolkit": ["@shepherdjerred/temporal"],
  "@arcade/frontend": ["@arcade/backend"],
  "@shepherdjerred/arcade": ["@arcade/backend"],
};

const EXTRA_PATH_REVERSE_TARGETS: readonly {
  readonly prefix: string;
  readonly targetWorkspace: string;
}[] = [
  {
    prefix: "packages/ts-mc-docs/src/content/docs/",
    targetWorkspace: "@shepherdjerred/storm-theme",
  },
  {
    prefix: "packages/scout-for-lol/scripts/contract-hash.ts",
    targetWorkspace: "@scout-for-lol/backend",
  },
  {
    prefix: "packages/scout-for-lol/tsconfig.base.json",
    targetWorkspace: "@scout-for-lol/backend",
  },
  {
    prefix: "packages/toolkit/",
    targetWorkspace: "@shepherdjerred/temporal",
  },
  {
    prefix: "ci/scripts/images/harden-codex-launcher.ts",
    targetWorkspace: "@shepherdjerred/temporal",
  },
  {
    prefix: "packages/discord-plays-mario-kart/Dockerfile",
    targetWorkspace: "@arcade/backend",
  },
  {
    prefix: "packages/discord-plays-mario-kart/spaghetti-src/",
    targetWorkspace: "@arcade/backend",
  },
  {
    prefix: "packages/discord-plays-pokemon/Dockerfile",
    targetWorkspace: "@arcade/backend",
  },
  {
    prefix: "packages/discord-plays-pokemon/wasm-src/",
    targetWorkspace: "@arcade/backend",
  },
  {
    prefix: "packages/the-storm/package.json",
    targetWorkspace: "@shepherdjerred/storm-forum",
  },
  {
    prefix: "packages/the-storm/public-status.json",
    targetWorkspace: "@shepherdjerred/storm-forum",
  },
  {
    prefix: "packages/the-storm/package.json",
    targetWorkspace: "@shepherdjerred/temporal",
  },
  {
    prefix: "packages/the-storm/maintenance-status.json",
    targetWorkspace: "@shepherdjerred/temporal",
  },
  {
    prefix:
      "packages/the-storm/server/owned/plugins/TheStorm/plot-reconcile.json",
    targetWorkspace: "@shepherdjerred/temporal",
  },
  {
    prefix: "packages/the-storm/server/owned/plugins/TheStorm/rwf-archive.json",
    targetWorkspace: "@shepherdjerred/temporal",
  },
  { prefix: "packages/the-storm/plugin/", targetWorkspace: "homelab" },
  { prefix: "packages/the-storm/server/", targetWorkspace: "homelab" },
  {
    prefix: "packages/the-storm/public-status.json",
    targetWorkspace: "homelab",
  },
  {
    prefix: "packages/feature-flags/src/managed-flag-inventory.json",
    targetWorkspace: "homelab",
  },
  {
    prefix: "packages/storm-brain/contracts/companion-chat.json",
    targetWorkspace: "homelab",
  },
  {
    prefix: "packages/glitter-boys-launcher/.dockerignore",
    targetWorkspace: "homelab",
  },
  {
    prefix: "packages/glitter-boys-launcher/Cargo.lock",
    targetWorkspace: "homelab",
  },
  {
    prefix: "packages/glitter-boys-launcher/Cargo.toml",
    targetWorkspace: "homelab",
  },
  {
    prefix: "packages/glitter-boys-launcher/Dockerfile",
    targetWorkspace: "homelab",
  },
  {
    prefix: "packages/glitter-boys-launcher/crates/",
    targetWorkspace: "homelab",
  },
];

function pathMatchesInput(filePath: string, input: string): boolean {
  return input.endsWith("/") ? filePath.startsWith(input) : filePath === input;
}

export function isGlobalRootInput(filePath: string): boolean {
  return (
    EXACT_GLOBAL_ROOT_INPUTS.has(filePath) ||
    (!filePath.includes("/") && filePath.startsWith(".jscpd")) ||
    GLOBAL_ROOT_PREFIXES.some((prefix) => filePath.startsWith(prefix))
  );
}

export function isRootScriptsDirectOrExternalInput(filePath: string): boolean {
  return (
    filePath === "scripts" ||
    filePath === "ci" ||
    filePath === "renovate.json" ||
    filePath.startsWith("scripts/") ||
    filePath.startsWith("ci/") ||
    ROOT_SCRIPTS_EXTERNAL_INPUTS.some((input) =>
      pathMatchesInput(filePath, input),
    )
  );
}

function collectWorkspaceDeps(
  manifest: z.infer<typeof WorkspaceManifestSchema>,
): string[] {
  const names = new Set<string>();
  const fields = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ];
  for (const record of fields) {
    if (record === undefined) {
      continue;
    }
    for (const [depName, spec] of Object.entries(record)) {
      if (typeof spec === "string" && spec.startsWith("workspace:")) {
        names.add(depName);
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function hasWorkspacesArray(candidateRoot: string): Promise<boolean> {
  const file = Bun.file(path.join(candidateRoot, "package.json"));
  if (!(await file.exists())) {
    return false;
  }
  const parsed = RootManifestSchema.safeParse(await file.json());
  return parsed.success;
}

export async function resolveMonorepoRoot(
  cwd = process.cwd(),
): Promise<string> {
  const gitTop = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  });
  if (gitTop.exitCode === 0) {
    const candidate = gitTop.stdout.toString().trim();
    if (candidate.length > 0 && (await hasWorkspacesArray(candidate))) {
      return candidate;
    }
  }
  const sourceFallback = path.resolve(import.meta.dir, "../../../../../..");
  if (await hasWorkspacesArray(sourceFallback)) {
    return sourceFallback;
  }
  throw new Error(
    `Could not locate monorepo root package.json from cwd ${cwd}`,
  );
}

function addReverseEdge(
  reverseMutable: Map<string, Set<string>>,
  dep: string,
  dependent: string,
): void {
  const existing = reverseMutable.get(dep);
  if (existing === undefined) {
    reverseMutable.set(dep, new Set([dependent]));
    return;
  }
  existing.add(dependent);
}

export function buildWorkspaceGraph(
  repoRoot: string,
  nodes: readonly WorkspaceNode[],
): WorkspaceGraph {
  const packages = new Map<string, WorkspaceNode>();
  const reverseMutable = new Map<string, Set<string>>();
  for (const node of nodes) {
    packages.set(node.name, { ...node, dir: node.dir.replace(/\/+$/u, "") });
    reverseMutable.set(node.name, new Set());
  }
  for (const node of packages.values()) {
    for (const dep of node.workspaceDependencies) {
      addReverseEdge(reverseMutable, dep, node.name);
    }
  }
  for (const [dep, extraDependents] of Object.entries(
    EXTRA_WORKSPACE_REVERSE_EDGES,
  )) {
    if (!packages.has(dep)) {
      continue;
    }
    for (const dependent of extraDependents) {
      if (packages.has(dependent)) {
        addReverseEdge(reverseMutable, dep, dependent);
      }
    }
  }
  const sortedDirs = [...packages.values()]
    .map((pkg) => ({ dir: pkg.dir, name: pkg.name }))
    .sort(
      (left, right) =>
        right.dir.length - left.dir.length || left.dir.localeCompare(right.dir),
    );
  return {
    repoRoot,
    packages,
    sortedDirs,
    reverseEdges: reverseMutable,
  };
}

const graphCache = new Map<string, Promise<WorkspaceGraph>>();

export function loadWorkspaceGraph(repoRoot?: string): Promise<WorkspaceGraph> {
  return (async () => {
    const resolvedRoot = repoRoot ?? (await resolveMonorepoRoot());
    const cached = graphCache.get(resolvedRoot);
    if (cached !== undefined) {
      return cached;
    }
    const promise = (async () => {
      const rootJson: unknown = await Bun.file(
        path.join(resolvedRoot, "package.json"),
      ).json();
      const rootManifest = RootManifestSchema.parse(rootJson);
      const nodes = await Promise.all(
        rootManifest.workspaces.map(async (dir): Promise<WorkspaceNode> => {
          const manifestJson: unknown = await Bun.file(
            path.join(resolvedRoot, dir, "package.json"),
          ).json();
          const manifest = WorkspaceManifestSchema.parse(manifestJson);
          return {
            name: manifest.name,
            dir,
            workspaceDependencies: collectWorkspaceDeps(manifest),
          };
        }),
      );
      return buildWorkspaceGraph(resolvedRoot, nodes);
    })();
    graphCache.set(resolvedRoot, promise);
    try {
      return await promise;
    } catch (error) {
      graphCache.delete(resolvedRoot);
      throw error;
    }
  })();
}

export function owningWorkspace(
  filePath: string,
  graph: WorkspaceGraph,
): string | null {
  if (filePath === "ci" || filePath.startsWith("ci/")) {
    return graph.packages.has(ROOT_SCRIPTS_PACKAGE)
      ? ROOT_SCRIPTS_PACKAGE
      : null;
  }
  const match = graph.sortedDirs.find(
    (entry) => filePath === entry.dir || filePath.startsWith(`${entry.dir}/`),
  );
  return match?.name ?? null;
}

export function directWorkspaces(
  paths: readonly string[],
  graph: WorkspaceGraph,
): Set<string> {
  const direct = new Set<string>();
  for (const filePath of paths) {
    const owner = owningWorkspace(filePath, graph);
    if (owner !== null) {
      direct.add(owner);
    }
  }
  return direct;
}

function collectExtraPathTargets(
  paths: readonly string[],
  graph: WorkspaceGraph,
  seeds: Set<string>,
): void {
  for (const filePath of paths) {
    for (const rule of EXTRA_PATH_REVERSE_TARGETS) {
      if (
        pathMatchesInput(filePath, rule.prefix) &&
        graph.packages.has(rule.targetWorkspace)
      ) {
        seeds.add(rule.targetWorkspace);
      }
    }
  }
}

/**
 * Compute `ReverseClosure(paths)`: every workspace directly owned by `paths`
 * plus transitive reverse dependents.
 *
 * `@shepherdjerred/root-scripts` is depended on by `@homelab/cdk8s`, `homelab`,
 * and `@shepherdjerred/temporal`, while itself depending on shared libraries.
 * Outgoing reverse edges FROM `@shepherdjerred/root-scripts` are traversed ONLY
 * when `paths` directly touched `scripts/**` or a `ROOT_SCRIPTS_EXTERNAL_INPUTS`
 * entry, preventing `@homelab/cdk8s` from acting as a false-positive transit hub.
 */
export function reverseClosureForPaths(
  paths: readonly string[],
  graph: WorkspaceGraph,
): Set<string> {
  const seeds = directWorkspaces(paths, graph);
  const allowRootScriptsBridge = paths.some((filePath) =>
    isRootScriptsDirectOrExternalInput(filePath),
  );
  if (allowRootScriptsBridge && graph.packages.has(ROOT_SCRIPTS_PACKAGE)) {
    seeds.add(ROOT_SCRIPTS_PACKAGE);
  }
  collectExtraPathTargets(paths, graph, seeds);

  const visited = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined || visited.has(current)) {
      continue;
    }
    visited.add(current);
    if (current === ROOT_SCRIPTS_PACKAGE && !allowRootScriptsBridge) {
      continue;
    }
    for (const dependent of graph.reverseEdges.get(current) ?? []) {
      queue.push(dependent);
    }
  }
  return visited;
}

export function touchesSynthesisGroup(
  paths: readonly string[],
  direct: ReadonlySet<string>,
): boolean {
  for (const pkg of direct) {
    if (SYNTHESIS_WORKSPACES.has(pkg)) {
      return true;
    }
  }
  return paths.some((filePath) =>
    filePath.startsWith("packages/delivery/registrations/"),
  );
}
