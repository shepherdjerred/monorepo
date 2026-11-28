import path from "node:path";
import { z } from "zod";

/**
 * Runs the extended test tier: every `test:extended` task in the Turbo graph,
 * the steps marked `tier: "extended"` in workspaces' ci-tests.json (suites that
 * start PostgreSQL, the Temporal test server, ffmpeg or a game server, or
 * exceed a three-minute p50). Pull-request verification never runs this tier;
 * the committer runs it locally for affected workspaces and the nightly
 * ci-extended-verify pipeline runs it on main.
 *
 * Extra arguments reach Turbo unchanged, except when a git-range `--filter`
 * (`--filter=...[<range>]`) includes `.mise.toml` without changing any runtime
 * `[tools]` entry used by extended suites: `.mise.toml` stays in root
 * `turbo.json` `globalDependencies` for task caching, so we narrow the filter
 * to the non-`.mise.toml` changed workspaces (or exit 0 when none changed).
 */
export const EXTENDED_TASK = "test:extended";
export const EXTENDED_CONCURRENCY = 1;
export const EXTENDED_VITEST_MAX_WORKERS = 2;

export const EXTENDED_RUNTIME_MISE_TOOLS = [
  "bun",
  "node",
  "python",
  "rust",
  "dotnet",
  "java",
  "gradle",
  "aqua:ip7z/7zip",
  "github:theseus-rs/postgresql-binaries",
] as const;

const GLOBAL_TURBO_INPUT_FILES = new Set([
  "package.json",
  "bun.lock",
  "turbo.json",
  "global.json",
  "bunfig.toml",
  "tsconfig.base.json",
  "vitest.config.ts",
  "packages/homelab/tsconfig.base.json",
  "packages/scout-for-lol/tsconfig.base.json",
]);

const MiseTomlSchema = z
  .object({
    tools: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const RootPackageWorkspacesSchema = z.object({
  workspaces: z.array(z.string()),
});
const WorkspaceNameSchema = z.object({
  name: z.string(),
});

export type ExtendedGitRangeReader = {
  readonly readChangedFiles: (
    range: string,
  ) => Promise<readonly string[] | undefined>;
  readonly readMiseTomlPair: (
    range: string,
  ) => Promise<{ readonly base: string; readonly target: string } | undefined>;
  readonly readWorkspaces: () => Promise<ReadonlyMap<string, string>>;
};

export function extendedRuntimeMiseToolsChanged(
  baseTomlText: string,
  targetTomlText: string,
): boolean {
  try {
    const baseParsed = MiseTomlSchema.parse(Bun.TOML.parse(baseTomlText));
    const targetParsed = MiseTomlSchema.parse(Bun.TOML.parse(targetTomlText));
    const baseTools = baseParsed.tools ?? {};
    const targetTools = targetParsed.tools ?? {};
    return EXTENDED_RUNTIME_MISE_TOOLS.some(
      (tool) => !Bun.deepEquals(baseTools[tool], targetTools[tool]),
    );
  } catch {
    return true;
  }
}

async function runGitText(
  args: readonly string[],
  cwd: string,
): Promise<string | undefined> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const [exitCode, text] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ]);
  return exitCode === 0 ? text : undefined;
}

function createDefaultGitRangeReader(
  repositoryRoot = path.resolve(import.meta.dirname, ".."),
): ExtendedGitRangeReader {
  return {
    async readChangedFiles(range) {
      const diffOut = await runGitText(
        ["diff", "--no-renames", "--name-only", range],
        repositoryRoot,
      );
      if (diffOut === undefined) return;
      const files = new Set(
        diffOut.split("\n").filter((entry) => entry !== ""),
      );
      if (!range.includes("..")) {
        const untrackedOut = await runGitText(
          ["ls-files", "--others", "--exclude-standard"],
          repositoryRoot,
        );
        if (untrackedOut !== undefined) {
          for (const entry of untrackedOut.split("\n")) {
            if (entry !== "") files.add(entry);
          }
        }
      }
      return [...files];
    },
    async readMiseTomlPair(range) {
      if (range.includes("...")) {
        const [left = "", right = ""] = range.split("...", 2);
        const targetRef = right === "" ? "HEAD" : right;
        const mergeBaseOut = await runGitText(
          ["merge-base", left, targetRef],
          repositoryRoot,
        );
        const baseRef = mergeBaseOut?.trim();
        if (baseRef === undefined || baseRef === "") return;
        const [base, target] = await Promise.all([
          runGitText(["show", `${baseRef}:.mise.toml`], repositoryRoot),
          runGitText(["show", `${targetRef}:.mise.toml`], repositoryRoot),
        ]);
        return base === undefined || target === undefined
          ? undefined
          : { base, target };
      }
      if (range.includes("..")) {
        const [left = "", right = ""] = range.split("..", 2);
        const targetRef = right === "" ? "HEAD" : right;
        const [base, target] = await Promise.all([
          runGitText(["show", `${left}:.mise.toml`], repositoryRoot),
          runGitText(["show", `${targetRef}:.mise.toml`], repositoryRoot),
        ]);
        return base === undefined || target === undefined
          ? undefined
          : { base, target };
      }
      const base = await runGitText(
        ["show", `${range}:.mise.toml`],
        repositoryRoot,
      );
      const targetFile = Bun.file(path.join(repositoryRoot, ".mise.toml"));
      return base === undefined || !(await targetFile.exists())
        ? undefined
        : { base, target: await targetFile.text() };
    },
    async readWorkspaces() {
      const rootPkg = RootPackageWorkspacesSchema.parse(
        await Bun.file(path.join(repositoryRoot, "package.json")).json(),
      );
      const directories = ["scripts", ...rootPkg.workspaces];
      const entries = await Promise.all(
        directories.map(async (directory) => {
          const pkg = WorkspaceNameSchema.parse(
            await Bun.file(
              path.join(repositoryRoot, directory, "package.json"),
            ).json(),
          );
          return [directory, pkg.name] as const;
        }),
      );
      return new Map(entries);
    },
  };
}

type ParsedGitFilter = {
  readonly startIndex: number;
  readonly span: 1 | 2;
  readonly includeDependents: boolean;
  readonly range: string;
};

function findGitRangeFilter(
  forwardedArgs: readonly string[],
): ParsedGitFilter | undefined {
  const pattern = /^(\.\.\.)?\[([^\]]+)\]$/u;
  for (let index = 0; index < forwardedArgs.length; index += 1) {
    const arg = forwardedArgs[index] ?? "";
    if (arg.startsWith("--filter=") || arg.startsWith("-F=")) {
      const value = arg.slice(arg.indexOf("=") + 1);
      const match = pattern.exec(value);
      if (match?.[2] !== undefined) {
        return {
          startIndex: index,
          span: 1,
          includeDependents: match[1] === "...",
          range: match[2],
        };
      }
    } else if (arg === "--filter" || arg === "-F") {
      const next = forwardedArgs[index + 1];
      const match = next === undefined ? null : pattern.exec(next);
      if (match?.[2] !== undefined) {
        return {
          startIndex: index,
          span: 2,
          includeDependents: match[1] === "...",
          range: match[2],
        };
      }
    }
  }
  return undefined;
}

function requiresFullGraphForChangedFile(file: string): boolean {
  return (
    GLOBAL_TURBO_INPUT_FILES.has(file) ||
    file.startsWith("patches/") ||
    file.startsWith("scripts/ci/")
  );
}

function owningWorkspaceForFile(
  file: string,
  sortedWorkspaceDirs: readonly (readonly [string, string])[],
): string | undefined {
  for (const [directory, packageName] of sortedWorkspaceDirs) {
    if (file === directory || file.startsWith(`${directory}/`)) {
      return packageName;
    }
  }
  return undefined;
}

export type ResolvedExtendedArgs =
  | { readonly skip: true; readonly reason: string }
  | { readonly skip: false; readonly args: string[] };

export async function resolveExtendedForwardedArgs(
  forwardedArgs: readonly string[],
  reader: ExtendedGitRangeReader = createDefaultGitRangeReader(),
): Promise<ResolvedExtendedArgs> {
  const gitFilter = findGitRangeFilter(forwardedArgs);
  if (gitFilter === undefined) {
    return { skip: false, args: [...forwardedArgs] };
  }
  const changedFiles = await reader.readChangedFiles(gitFilter.range);
  if (changedFiles?.includes(".mise.toml") !== true) {
    return { skip: false, args: [...forwardedArgs] };
  }
  const misePair = await reader.readMiseTomlPair(gitFilter.range);
  if (
    misePair === undefined ||
    extendedRuntimeMiseToolsChanged(misePair.base, misePair.target)
  ) {
    return { skip: false, args: [...forwardedArgs] };
  }

  const remainingFiles = changedFiles.filter(
    (file) => file !== ".mise.toml" && file !== "mise.lock",
  );
  if (remainingFiles.some((file) => requiresFullGraphForChangedFile(file))) {
    return { skip: false, args: [...forwardedArgs] };
  }

  const workspaces = await reader.readWorkspaces();
  const sortedWorkspaceDirs = [...workspaces.entries()].sort(
    ([left], [right]) => right.length - left.length,
  );
  const selectedPackages = new Set<string>();
  for (const file of remainingFiles) {
    const pkg = owningWorkspaceForFile(file, sortedWorkspaceDirs);
    if (pkg !== undefined) selectedPackages.add(pkg);
  }

  if (selectedPackages.size === 0) {
    return {
      skip: true,
      reason:
        "[verify:extended] Skipping test:extended: .mise.toml changes do not affect extended-tier runtime tools and no workspace files changed.",
    };
  }

  const replacementFilters = [...selectedPackages]
    .sort((left, right) => left.localeCompare(right))
    .map(
      (pkg) => `--filter=${gitFilter.includeDependents ? `...${pkg}` : pkg}`,
    );
  return {
    skip: false,
    args: [
      ...forwardedArgs.slice(0, gitFilter.startIndex),
      ...replacementFilters,
      ...forwardedArgs.slice(gitFilter.startIndex + gitFilter.span),
    ],
  };
}

export function extendedTurboCommand(
  forwardedArgs: readonly string[],
): string[] {
  const hasConcurrencyOverride = forwardedArgs.some(
    (argument) =>
      argument === "--concurrency" || argument.startsWith("--concurrency="),
  );
  return [
    "bun",
    "x",
    "--no-install",
    "turbo",
    "run",
    EXTENDED_TASK,
    "--continue",
    ...(hasConcurrencyOverride
      ? []
      : [`--concurrency=${String(EXTENDED_CONCURRENCY)}`]),
    ...forwardedArgs,
  ];
}

export function extendedEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return {
    ...environment,
    CI_VITEST_MAX_WORKERS:
      environment["CI_VITEST_MAX_WORKERS"] ??
      String(EXTENDED_VITEST_MAX_WORKERS),
  };
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
  reader?: ExtendedGitRangeReader,
): Promise<number> {
  const forwardedArgs = argv.filter((argument) => argument !== "--");
  const resolved = await resolveExtendedForwardedArgs(forwardedArgs, reader);
  if (resolved.skip) {
    console.log(resolved.reason);
    return 0;
  }
  const turbo = Bun.spawn(extendedTurboCommand(resolved.args), {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: extendedEnvironment(environment),
  });
  return turbo.exited;
}

if (import.meta.main) process.exitCode = await main();
