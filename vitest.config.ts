import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "node:process";

const defaultTestInclude = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];
const defaultTestExclude = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.claude/worktrees/**",
  "**/.codex/**",
];

const defaultRepositoryRoot = __dirname;

function sanitizeWorkspaceCacheSlug(workspacePath: string): string {
  if (workspacePath === "" || workspacePath === ".") return "root";
  const normalized = workspacePath
    .replaceAll("..", "up")
    .replaceAll(/[^\w.-]+/gu, "__")
    .replaceAll(/^[._]+|[._]+$/gu, "");
  return normalized === "" ? "root" : normalized;
}

function resolveVitestPackageRealpath(
  workspaceDir: string,
  repoDir: string,
): string {
  for (const candidateRoot of [workspaceDir, repoDir]) {
    try {
      return realpathSync(
        path.join(candidateRoot, "node_modules", "vitest", "package.json"),
      );
    } catch {
      // Fall back to repositoryRoot when invoked from a directory without direct vitest symlink.
    }
  }
  return "unresolved";
}

function readDirectoryMtimeToken(directory: string): string {
  try {
    return String(Math.trunc(statSync(directory).mtimeMs));
  } catch {
    return "missing";
  }
}

function currentRuntimeIdentifier(): string {
  const bunVersion = process.versions["bun"];
  return bunVersion === undefined
    ? `node-${process.versions.node}`
    : `bun-${bunVersion}`;
}

type VitestConfigTestOverrides = {
  readonly repositoryRoot: string;
  readonly workspaceRoot: string;
  readonly tier?: string | undefined;
  readonly group?: string | undefined;
  readonly runtime?: string | undefined;
  readonly ci?: string | undefined;
  readonly tempDir?: string | undefined;
  readonly resolveVitestRealpath?: (() => string) | undefined;
  readonly readDirMtime?: ((directory: string) => string) | undefined;
};

type ViteConfigEnvLike = {
  readonly mode?: string | undefined;
  readonly command?: string | undefined;
};

function resolveVitestCachePaths(options: VitestConfigTestOverrides): {
  readonly cacheDir: string;
  readonly fsModuleCachePath: string;
} {
  const relativeWorkspace = path
    .relative(options.repositoryRoot, options.workspaceRoot)
    .split(path.sep)
    .join("/");
  const tier = options.tier ?? "default";
  const group = options.group ?? "";
  const runtime = options.runtime ?? currentRuntimeIdentifier();
  const readMtime = options.readDirMtime ?? readDirectoryMtimeToken;
  const vitestRealpath =
    options.resolveVitestRealpath === undefined
      ? resolveVitestPackageRealpath(
          options.workspaceRoot,
          options.repositoryRoot,
        )
      : options.resolveVitestRealpath();

  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        workspace: relativeWorkspace,
        tier,
        group,
        runtime,
        vitestRealpath,
        bunStoreMtime: readMtime(
          path.join(options.repositoryRoot, "node_modules", ".bun"),
        ),
        workspaceNodeModulesMtime: readMtime(
          path.join(options.workspaceRoot, "node_modules"),
        ),
      }),
    )
    .digest("hex")
    .slice(0, 16);

  const workspaceSlug = sanitizeWorkspaceCacheSlug(relativeWorkspace);
  const tierSlug = sanitizeWorkspaceCacheSlug(tier);
  // Vitest's transformed-module cache defaults to node_modules/.vitest-cache,
  // ~240 MB per verify written to the CI workspace volume. CI's TMPDIR is
  // disposable scratch (tmpfs in verify), so moving the per-workspace cache
  // root there avoids workspace-volume churn while keeping local caches persistent.
  const cacheRoot =
    (options.ci ?? "") === ""
      ? path.join(options.repositoryRoot, "node_modules", ".vitest-cache")
      : path.join(options.tempDir ?? tmpdir(), "vitest-cache");
  const baseDirectory = path.join(
    cacheRoot,
    `${workspaceSlug}-${tierSlug}-${digest}`,
  );
  return {
    cacheDir: path.join(baseDirectory, "vite"),
    fsModuleCachePath: path.join(baseDirectory, "fs-module-cache"),
  };
}

function vitestMaxWorkers(value: string | undefined): number {
  if (value === undefined) return 4;
  const workers = Number(value);
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(
      `CI_VITEST_MAX_WORKERS must be a positive integer: ${value}`,
    );
  }
  return workers;
}

function replaceBunImportMetaDir(code: string, filename: string): string {
  const directory = JSON.stringify(path.dirname(filename));
  const filePath = JSON.stringify(filename);
  code = code.replaceAll(
    /\$\{import\.meta\.(?:dirname|dir)\}/g,
    `\${${directory}}`,
  );
  code = code.replaceAll(/\$\{import\.meta\.path\}/g, `\${${filePath}}`);
  let output = "";
  let index = 0;
  let quote: '"' | "'" | "`" | undefined;
  let lineComment = false;
  let blockComment = false;
  while (index < code.length) {
    const character = code[index];
    const next = code[index + 1];
    if (lineComment) {
      output += character;
      index += 1;
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      output += character;
      index += 1;
      if (character === "*" && next === "/") {
        output += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (quote !== undefined) {
      output += character;
      index += 1;
      if (character === "\\") {
        output += code[index] ?? "";
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      output += "//";
      index += 2;
      lineComment = true;
      continue;
    }
    if (character === "/" && next === "*") {
      output += "/*";
      index += 2;
      blockComment = true;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      output += character;
      index += 1;
      quote = character;
      continue;
    }
    const match = /^import\.meta\.(?:dirname|dir)\b/.exec(code.slice(index));
    if (match !== null) {
      output += directory;
      index += match[0].length;
      continue;
    }
    const pathMatch = /^import\.meta\.path\b/.exec(code.slice(index));
    if (pathMatch !== null) {
      output += filePath;
      index += pathMatch[0].length;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

export default function createVitestConfig(
  overridesOrConfigEnv?: VitestConfigTestOverrides | ViteConfigEnvLike,
) {
  const custom =
    overridesOrConfigEnv !== undefined &&
    "repositoryRoot" in overridesOrConfigEnv
      ? overridesOrConfigEnv
      : undefined;
  const repositoryRoot = custom?.repositoryRoot ?? defaultRepositoryRoot;
  const workspaceRoot = custom?.workspaceRoot ?? process.cwd();
  const workspace = path
    .relative(repositoryRoot, workspaceRoot)
    .split(path.sep)
    .join("/");

  const cachePaths = resolveVitestCachePaths(
    custom ?? {
      repositoryRoot,
      workspaceRoot,
      tier: env["CI_TEST_TIER"],
      group: env["CI_TEST_GROUP"],
      ci: env["CI"],
      tempDir: tmpdir(),
    },
  );

  const setupFilesByWorkspace: Readonly<Record<string, readonly string[]>> = {
    "packages/birmel": [path.join(workspaceRoot, "tests/setup.ts")],
    "packages/streambot": [path.join(workspaceRoot, "test/setup.ts")],
    "packages/cooklang-for-obsidian": [
      path.join(workspaceRoot, "test/setup.ts"),
    ],
    "packages/scout-for-lol": [
      path.join(workspaceRoot, "packages/backend/test-setup.ts"),
    ],
    "packages/scout-for-lol/packages/backend": [
      path.join(workspaceRoot, "test-setup.ts"),
    ],
    "packages/temporal": [path.join(workspaceRoot, "test-setup.ts")],
  };
  const setupFiles = [...(setupFilesByWorkspace[workspace] ?? [])];

  const coverageThresholds =
    workspace === "packages/birmel"
      ? {
          // Bun's 50% threshold counted the test implementation in coverage.
          // Vitest always excludes discovered test files, so 40% retains a
          // stricter production-code-only floor than the previous Bun result.
          lines: 40,
        }
      : workspace === "packages/scout-for-lol" ||
          workspace === "packages/scout-for-lol/packages/backend"
        ? { lines: 70, functions: 70 }
        : undefined;

  const coverageExclusions =
    workspace === "packages/scout-for-lol"
      ? [
          "**/generated/**",
          "**/*.test.ts",
          "**/*.integration.test.ts",
          "**/node_modules/**",
          "**/__tests__/**",
          "**/dist/**",
          // Scope this to Scout's package tree: CI checks out the
          // repository below /workspace/build, so an unanchored **/build/**
          // excludes every source file and produces an empty coverage report.
          path.join(workspaceRoot, "packages", "**", "build", "**"),
        ]
      : workspace === "packages/scout-for-lol/packages/backend"
        ? [
            "**/generated/**",
            "**/*.test.ts",
            "**/*.integration.test.ts",
            "**/node_modules/**",
            "**/*.spec.ts",
            "**/__tests__/**",
          ].filter((entry) => entry !== "**/*.spec.ts")
        : ["**/node_modules/**"];

  return {
    root: workspaceRoot,
    cacheDir: cachePaths.cacheDir,
    resolve: {
      alias:
        workspace === "packages/homelab/src/cdk8s"
          ? {
              "@shepherdjerred/homelab/cdk8s": workspaceRoot,
              "@shepherdjerred/homelab/scripts": path.join(
                repositoryRoot,
                "packages/homelab/scripts",
              ),
              "@shepherdjerred/monorepo/config": path.join(
                repositoryRoot,
                "config",
              ),
            }
          : {},
    },
    plugins: [
      {
        name: "bun-import-meta",
        transform(code: string, id: string) {
          if (
            !/import\.meta\.(?:dirname|dir|path)\b/u.test(code) ||
            id.startsWith("\0")
          ) {
            return;
          }
          const filename = id.split("?", 1)[0];
          if (filename === undefined) return;
          return replaceBunImportMetaDir(code, filename);
        },
      },
      {
        name: "raw-text",
        enforce: "pre",
        async load(id: string) {
          if (
            !id.endsWith(".txt") &&
            // Toolkit embeds its mitmproxy addon with a Bun text import.
            !id.endsWith("/toolkit/capture/brim_capture.py") &&
            !id.includes("/asciinema-player/dist/bundle/asciinema-player.")
          ) {
            return;
          }
          return `export default ${JSON.stringify(await readFile(id, "utf8"))};`;
        },
      },
    ],
    test: {
      env: { TZ: "UTC" },
      pool: "forks",
      fsModuleCachePath: cachePaths.fsModuleCachePath,
      // Verify runs several package tasks at once on a 12-CPU pod and sets
      // CI_VITEST_MAX_WORKERS so nested worker pools cannot oversubscribe it.
      maxWorkers: vitestMaxWorkers(env["CI_VITEST_MAX_WORKERS"]),
      exclude: [
        ...defaultTestExclude,
        // Globs, so forward slashes: `path.join` gives backslashes on Windows,
        // which a glob reads as escapes, and the file is then collected anyway.
        ...(workspace === "packages/scout-for-lol"
          ? [
              path
                .join(
                  workspaceRoot,
                  "packages/backend/scripts/branded-types.test.ts",
                )
                .split(path.sep)
                .join("/"),
            ]
          : workspace === "packages/scout-for-lol/packages/backend"
            ? [
                path
                  .join(workspaceRoot, "scripts/branded-types.test.ts")
                  .split(path.sep)
                  .join("/"),
              ]
            : []),
      ],
      setupFiles,
      ...(workspace === "packages/tracker"
        ? { globalSetup: [path.join(workspaceRoot, "vitest.global-setup.ts")] }
        : {}),
      ...(env["BIRMEL_VITEST_HARNESS"] === undefined
        ? {}
        : { include: [env["BIRMEL_VITEST_HARNESS"]] }),
      ...(workspace === "scripts"
        ? {
            include: [
              ...defaultTestInclude,
              "../ci/scripts/**/*.{test,spec}.?(c|m)[jt]s?(x)",
              // Qualified image reuse depends on the canonical ownership index
              // and on the registry that names each build's owner.
              "../packages/ops-model/src/catalog.test.ts",
              "../packages/ops-model/src/delivery-catalog/publication-owners.test.ts",
              // ...and on the catalog document's shape, which the registry reads.
              "../packages/ops-model/src/catalog-document.test.ts",
            ],
          }
        : {}),
      ...(workspace === "packages/birmel"
        ? {
            fileParallelism: false,
            globalSetup: [
              path.join(
                workspaceRoot,
                "src/agent-tools/tools/automation/test-setup.ts",
              ),
            ],
          }
        : {}),
      ...(workspace === "packages/toolkit"
        ? { server: { deps: { inline: ["asciinema-player"] } } }
        : {}),
      deps: {
        // Vitest 4.1.x applies Node-style CJS interop to genuine ESM modules.
        // Bun exposes a present-but-undefined __esModule export, so the default
        // wrapper drops named exports such as Zod's `z`. Bun can load both ESM
        // and CJS directly; disable that Node-only wrapper until Vitest 5.
        interopDefault: false,
      },
      coverage: {
        provider: "istanbul",
        reporter: ["text", "lcovonly"],
        // These suites exercise source outside their project roots: docs-site
        // imports sibling Scout data, while root-scripts owns the CI scripts.
        allowExternal:
          workspace === "packages/scout-for-lol/packages/docs-site" ||
          workspace === "scripts",
        exclude: coverageExclusions,
        thresholds: coverageThresholds,
      },
    },
  };
}
