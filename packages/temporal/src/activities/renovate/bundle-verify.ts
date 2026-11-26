import { lstat, realpath } from "node:fs/promises";
import nodePath from "node:path";
import { z } from "zod/v4";
import type {
  RankedRenovateUpdate,
  RenovateTarget,
} from "@shepherdjerred/ops-model/renovate-ranking.ts";
import { rootInstallWithoutHooks } from "#activities/bot-clone.ts";
import { listDirtyRepoPaths } from "#activities/remediation/codex-pr-remediation-git.ts";
import type { GitCommandRunner } from "#activities/scout/scout-season-refresh-git.ts";
import {
  actualPinFile,
  expectedPinFile,
  targetsByFile,
  verifiedPinTable,
} from "./bundle-pins.ts";
import {
  allowScopedSourcePath,
  bundleLanes,
  candidateReservedPaths,
  dependencyFields,
  isSafeBundlePath,
  targetArtifactPaths,
  type BundleLane,
} from "./bundle-policy.ts";
import {
  cleanIgnoredAgentArtifacts,
  PYTHON_BUNDLE_CHECKS,
  sandboxBundleVerification,
} from "./bundle-sandbox.ts";

const { posix } = nodePath;

type BundleRepository = {
  readonly repoDir: string;
  readonly baseSha: string;
  readonly trackedPaths: ReadonlySet<string>;
  readonly commandRunner: GitCommandRunner;
};

type VerificationCommand = { args: string[]; cwd: string };

export type PreparedBundleEvidence = {
  changedFiles: string[];
  verificationSummary: string;
  demo: string;
  diffSha256: string;
};

export async function readCommittedPinFile(
  repo: BundleRepository,
  file: string,
): Promise<string> {
  if (!isSafeBundlePath(file) || !repo.trackedPaths.has(file)) {
    throw new Error(`Untracked or invalid Renovate target path: ${file}`);
  }
  return repo.commandRunner(["git", "show", `${repo.baseSha}:${file}`], {
    cwd: repo.repoDir,
    trimStdout: false,
  });
}

const ManifestSchema = z.record(z.string(), z.unknown());

function declaresDependency(
  value: unknown,
  dependencies: ReadonlySet<string>,
): boolean {
  const record = ManifestSchema.safeParse(value);
  return (
    record.success &&
    Object.entries(record.data).some(
      ([key, child]) =>
        dependencies.has(key) || declaresDependency(child, dependencies),
    )
  );
}

async function allowedSourceRoots(
  repo: BundleRepository,
  targets: readonly RenovateTarget[],
  allowedFiles: ReadonlySet<string>,
): Promise<Set<string>> {
  const roots = new Set<string>();
  for (const file of allowedFiles) {
    const parent = posix.dirname(file);
    if (parent !== ".") roots.add(parent);
  }
  if (!targets.some((target) => target.manager === "npm")) return roots;

  // A shared package such as the ESLint config can require migrating its
  // existing workspace dependents as well as its own source.
  const dependencies = new Set(
    allowedFiles.has("package.json")
      ? targets.map((target) => target.packageName)
      : [],
  );
  const projects = await readWorkspaceManifests(repo);
  for (const [directory, manifest] of projects) {
    const name = manifest["name"];
    if (typeof name === "string" && roots.has(directory))
      dependencies.add(name);
  }
  includeDependentSourceRoots(projects, roots, dependencies);
  return roots;
}

async function readWorkspaceManifests(repo: BundleRepository) {
  const projects = new Map<string, Record<string, unknown>>();
  for (const file of repo.trackedPaths) {
    if (file.startsWith("packages/") && file.endsWith("/package.json")) {
      const manifest = ManifestSchema.parse(
        JSON.parse(await readCommittedPinFile(repo, file)),
      );
      projects.set(posix.dirname(file), manifest);
    }
  }
  return projects;
}

function includeDependentSourceRoots(
  projects: ReadonlyMap<string, Record<string, unknown>>,
  roots: Set<string>,
  dependencies: Set<string>,
): void {
  let addedProject: boolean;
  do {
    addedProject = false;
    for (const [directory, manifest] of projects) {
      if (
        roots.has(directory) ||
        !declaresDependency(dependencyFields(manifest), dependencies)
      )
        continue;
      roots.add(directory);
      addedProject = true;
      const name = manifest["name"];
      if (typeof name === "string") dependencies.add(name);
    }
  } while (addedProject);
}

function cmd(cwd: string, ...args: string[]): VerificationCommand {
  return { cwd, args };
}

function nativeVerificationCommands(
  repo: BundleRepository,
  lane: BundleLane,
  targets: readonly RenovateTarget[],
): VerificationCommand[] {
  const root = repo.repoDir;
  const files = new Set(
    targets.flatMap((target) => targetArtifactPaths(target, repo.trackedPaths)),
  );
  const dirs = [...new Set([...files].map((file) => posix.dirname(file)))];
  switch (lane) {
    case "cargo":
      return dirs.flatMap((dir) => [
        cmd(`${root}/${dir}`, "cargo", "fetch", "--locked"),
        cmd(
          `${root}/${dir}`,
          "cargo",
          "test",
          "--frozen",
          "--workspace",
          "--all-targets",
        ),
        cmd(
          `${root}/${dir}`,
          "cargo",
          "clippy",
          "--frozen",
          "--workspace",
          "--all-targets",
          "--",
          "-D",
          "warnings",
        ),
      ]);
    case "go":
      return dirs.flatMap((dir) => [
        cmd(`${root}/${dir}`, "go", "mod", "download"),
        cmd(`${root}/${dir}`, "go", "test", "-mod=readonly", "./..."),
        cmd(`${root}/${dir}`, "go", "vet", "-mod=readonly", "./..."),
      ]);
    case "python":
      return dirs.flatMap((dir) =>
        PYTHON_BUNDLE_CHECKS.map((check) => cmd(`${root}/${dir}`, ...check)),
      );
    case "dotnet": {
      const solutions = [...repo.trackedPaths].filter(
        (file) =>
          /\.slnx?$/u.test(file) &&
          dirs.some((dir) => {
            const solutionDir = posix.dirname(file);
            return (
              solutionDir === "." ||
              dir === solutionDir ||
              dir.startsWith(`${solutionDir}/`)
            );
          }),
      );
      return solutions.flatMap((solution) => [
        cmd(root, "dotnet", "restore", "--locked-mode", solution),
        cmd(root, "dotnet", "test", "--no-restore", solution),
      ]);
    }
    case "report":
      return [
        cmd(
          `${root}/packages/scout-for-lol/packages/report`,
          "bun",
          "run",
          "verify:visual-contract",
        ),
      ];
    case "repo":
      return [cmd(root, "bun", "run", "renovate-hints")];
    case "bun":
      return [];
  }
}

function targetsInLane(
  targets: readonly RenovateTarget[],
  lane: BundleLane,
): RenovateTarget[] {
  return targets.filter((target) =>
    bundleLanes({ targets: [target] }).has(lane),
  );
}

export function missingVerification(
  repo: BundleRepository,
  candidate: RankedRenovateUpdate,
  which: (command: string) => string | null,
): string | undefined {
  for (const lane of bundleLanes(candidate)) {
    const commands = nativeVerificationCommands(
      repo,
      lane,
      targetsInLane(candidate.targets, lane),
    );
    if (lane !== "bun" && commands.length === 0) {
      return `No locked ${lane} verification project was found for the ranked pins.`;
    }
    for (const check of commands) {
      const tool = check.args[0];
      if (tool !== undefined && which(tool) === null) {
        return `The repository worker does not have ${tool} for the required ${lane} verification.`;
      }
    }
  }
  return undefined;
}

async function assertExactTargets(
  repo: BundleRepository,
  targets: readonly RenovateTarget[],
  changedFiles: readonly string[],
): Promise<void> {
  const changed = new Set(changedFiles);
  for (const [file, fileTargets] of targetsByFile(targets)) {
    const before = await readCommittedPinFile(repo, file);
    const expected = expectedPinFile(file, before, fileTargets);
    if (expected === undefined || !changed.has(file)) {
      throw new Error(
        `Expected ranked pin changes could not be established in ${file}.`,
      );
    }
    const after = await Bun.file(`${repo.repoDir}/${file}`).text();
    if (expected !== actualPinFile(file, after)) {
      throw new Error(
        `The diff in ${file} does not match only the exact ranked pin changes.`,
      );
    }
  }
}

async function verifiedChangedFiles(
  repo: BundleRepository,
  allowedFiles: ReadonlySet<string>,
  sourceRoots: ReadonlySet<string>,
  reservedPaths: ReadonlySet<string>,
): Promise<string[]> {
  const modeSummary = await repo.commandRunner(
    ["git", "diff", "--summary", repo.baseSha],
    { cwd: repo.repoDir },
  );
  if (modeSummary.includes("mode change"))
    throw new Error("The dependency bundle changed a tracked file mode.");
  const changedFiles = await listDirtyRepoPaths(
    repo.repoDir,
    repo.commandRunner,
  );
  for (const file of changedFiles) {
    if (reservedPaths.has(file))
      throw new Error(`An open bundle already owns ${file}.`);
    if (
      !isSafeBundlePath(file) ||
      (!allowedFiles.has(file) && !allowScopedSourcePath(file, sourceRoots))
    ) {
      throw new Error(
        `The dependency bundle changed an unrelated path: ${file}`,
      );
    }
    const metadata = await lstat(`${repo.repoDir}/${file}`).catch(
      (error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return null;
        throw error;
      },
    );
    if (metadata !== null && !metadata.isFile())
      throw new Error(`Unexpected file type in dependency bundle: ${file}`);
  }
  return changedFiles;
}

async function assertInstalledBunVersions(
  repoDir: string,
  targets: readonly RenovateTarget[],
): Promise<void> {
  for (const target of targets) {
    if (target.targetVersion === null || target.manager !== "npm") continue;
    const project = posix.dirname(target.filePath);
    const workspace = `${repoDir}/${project}`;
    if (
      !/^(?:@[\w.-]+\/)?[\w.-]+$/u.test(target.packageName) ||
      target.packageName
        .split("/")
        .some((segment) => segment === "." || segment === "..")
    ) {
      throw new Error(
        "The installed npm package name could not be verified safely.",
      );
    }
    const installedFile = `${workspace}/node_modules/${target.packageName}/package.json`;
    const resolved = Bun.file(installedFile);
    // Root overrides and peer constraints have no direct installation at the
    // declaring workspace. The frozen install still validates their lockfile.
    if (!(await resolved.exists())) continue;
    const resolvedPath = nodePath.relative(
      await realpath(repoDir),
      await realpath(installedFile),
    );
    if (nodePath.isAbsolute(resolvedPath) || resolvedPath.startsWith("..")) {
      throw new Error(
        `The installed npm package ${target.packageName} resolves outside the checkout.`,
      );
    }
    const manifest = ManifestSchema.parse(await resolved.json());
    if (manifest["version"] !== target.targetVersion) {
      throw new Error(
        `The installed version of ${target.packageName} in ${project} is different from the exact ranked target ${target.targetVersion}.`,
      );
    }
  }
}

export async function readBundleDiff(
  repoDir: string,
  files: readonly string[],
  commandRunner: GitCommandRunner,
): Promise<string> {
  for (const file of files) {
    if (!isSafeBundlePath(file))
      throw new Error("Invalid path in verified bundle diff.");
    const tracked = await commandRunner(
      ["git", "--literal-pathspecs", "ls-files", "--", file],
      {
        cwd: repoDir,
      },
    );
    if (tracked === "")
      await commandRunner(
        ["git", "--literal-pathspecs", "add", "-N", "--", file],
        { cwd: repoDir },
      );
  }
  return commandRunner(
    [
      "git",
      "--literal-pathspecs",
      "diff",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--",
      ...files,
    ],
    { cwd: repoDir },
  );
}

export async function verifyPreparedRenovateBundle(
  input: BundleRepository & {
    tempDir: string;
    candidates: readonly RankedRenovateUpdate[];
    reservedPaths: ReadonlySet<string>;
    verificationSandbox: boolean;
  },
): Promise<PreparedBundleEvidence> {
  const targets = input.candidates.flatMap((candidate) => candidate.targets);
  const allowedFiles = new Set(
    input.candidates.flatMap((candidate) => [
      ...candidateReservedPaths(candidate, input.trackedPaths),
    ]),
  );
  const sourceRoots = await allowedSourceRoots(input, targets, allowedFiles);
  // A mixed reset exposes changes even if the agent staged or committed them.
  await input.commandRunner(["git", "reset", "--mixed", input.baseSha], {
    cwd: input.repoDir,
  });
  const changedFiles = await verifiedChangedFiles(
    input,
    allowedFiles,
    sourceRoots,
    input.reservedPaths,
  );
  await assertExactTargets(input, targets, changedFiles);
  const beforeChecks = await readBundleDiff(
    input.repoDir,
    changedFiles,
    input.commandRunner,
  );
  await cleanIgnoredAgentArtifacts(input);
  const lanes = new Set(
    input.candidates.flatMap((candidate) => [...bundleLanes(candidate)]),
  );
  const runCheck = input.verificationSandbox
    ? sandboxBundleVerification(input)
    : input.commandRunner;
  await rootInstallWithoutHooks(input.repoDir, (args, { cwd, env }) =>
    runCheck(args, { cwd, ...(env === undefined ? {} : { env }) }),
  );
  if (input.verificationSandbox)
    await assertInstalledBunVersions(input.repoDir, targets);
  const commands = [
    cmd(
      input.repoDir,
      "bunx",
      "--no-install",
      "turbo",
      "run",
      "build",
      "typecheck",
      "test",
      "lint",
      "test:extended",
      "--filter=...[HEAD]",
      "--continue",
    ),
    ...[...lanes].flatMap((lane) =>
      nativeVerificationCommands(input, lane, targetsInLane(targets, lane)),
    ),
    cmd(input.repoDir, "git", "diff", "--check", input.baseSha),
  ];
  for (const check of commands) await runCheck(check.args, { cwd: check.cwd });
  const verifiedFiles = await verifiedChangedFiles(
    input,
    allowedFiles,
    sourceRoots,
    input.reservedPaths,
  );
  const diff = await readBundleDiff(
    input.repoDir,
    verifiedFiles,
    input.commandRunner,
  );
  if (diff !== beforeChecks || diff.length === 0)
    throw new Error("Verification changed the prepared dependency diff.");
  return {
    changedFiles: verifiedFiles,
    verificationSummary: [
      "- Exact ranked pins and repository path scope verified.",
      "- `bun install --frozen-lockfile --ignore-scripts` passed.",
      ...commands.map((check) => `- \`${check.args.join(" ")}\` passed.`),
    ].join("\n"),
    demo: verifiedPinTable(targets),
    diffSha256: new Bun.CryptoHasher("sha256").update(diff).digest("hex"),
  };
}
