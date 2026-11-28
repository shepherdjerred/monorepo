#!/usr/bin/env bun

/**
 * Runs the browser suites that a change affects, the way CI does: Playwright
 * end-to-end projects and Vitest browser-mode `test:browser` targets.
 *
 * Pull requests no longer run the Playwright lane (it runs on the default
 * branch, and on pull requests that change `ci/ci-playwright/**`), so the
 * committer runs the affected projects before marking a PR ready:
 *
 *   bun run e2e:affected                  # projects affected since the merge base with origin/main
 *   bun run e2e:affected -- --base <ref>  # compare against another base instead
 *   bun run e2e:affected -- --all         # every Playwright project
 *   bun run e2e:affected -- --linux       # the same selection inside the pinned ci-playwright image
 *
 * This wraps `ci/scripts/selection/run-playwright.ts`, the same selector and
 * runner the main-branch lane executes, with the same environment: the changed
 * base from `git merge-base HEAD origin/main` and `CI=true` for the JUnit
 * reporters and bounded workers.
 *
 * Selection diffs committed changes (base..HEAD) while Turbo tests the working
 * tree, so a run with uncommitted changes would silently test one thing and
 * select another; it is refused. Visual snapshots are per platform
 * (`*-darwin.png`, `*-linux.png`): CI checks the Linux ones, so `--linux` runs
 * a clean clone of HEAD in the pinned image (Docker required). Browser
 * binaries for a host run must be installed locally (`bunx playwright install`).
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { ciImageDefinition } from "../ci/scripts/images/build-ci-image-core.ts";
import {
  allPlaywrightTargets,
  selectPlaywrightTargets,
  type PlaywrightSelection,
} from "../ci/scripts/selection/playwright-targets.ts";
import { loadWorkspaces } from "../ci/scripts/selectors/select-image-targets-workspaces.ts";

const RUNNER = "ci/scripts/selection/run-playwright.ts";
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const DIGEST_PATTERN = /^sha256:[\da-f]{64}$/u;
const BUN_CACHE_VOLUME = "e2e-affected-bun-cache";
const PLATFORM_SNAPSHOT = /-(?:darwin|linux|win32)\.png$/u;

export type E2eAffectedOptions = {
  /** Explicit base ref; the merge base with origin/main when absent. */
  readonly base: string | undefined;
  /** Run every project instead of the affected ones. */
  readonly all: boolean;
  /** Run inside the pinned ci-playwright image with Docker. */
  readonly linux: boolean;
};

export function parseE2eAffectedArgs(
  argv: readonly string[],
): E2eAffectedOptions {
  let base: string | undefined;
  let all = false;
  let linux = false;
  const args = argv.filter((argument) => argument !== "--");
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? "";
    switch (argument) {
      case "--all": {
        all = true;
        break;
      }
      case "--linux": {
        linux = true;
        break;
      }
      case "--base": {
        const value = args[++index];
        if (value === undefined || value === "" || value.startsWith("--"))
          throw new Error("--base needs a git ref");
        base = value;
        break;
      }
      default: {
        throw new Error(
          `unknown argument ${argument}; use --base <ref>, --all or --linux`,
        );
      }
    }
  }
  if (all && base !== undefined)
    throw new Error("--all and --base are mutually exclusive");
  return { base, all, linux };
}

/**
 * CI's own environment for the lane. An empty `CI_CHANGED_BASE` makes the
 * runner select every project, which is what `--all` asks for.
 */
export function e2eAffectedEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  changedBase: string,
): Record<string, string | undefined> {
  return {
    ...environment,
    CI: "true",
    CI_CHANGED_BASE: changedBase,
    // The runner installs through ci/scripts/bun-install.sh, which refuses to
    // guess between the in-cluster shared cache and a local one.
    BUN_INSTALL_LOCK_MODE: "local",
    BUN_CACHE_LOCK_FILE: undefined,
    // A parent CI pipeline must not turn this into a push or manual build.
    CI_PIPELINE_EVENT: undefined,
  };
}

/**
 * Selection reads base..HEAD and Turbo tests the working tree, so any
 * uncommitted change (including untracked files) would be tested without being
 * selected. Refuse it.
 */
export function dirtyTreeError(porcelain: string): string | undefined {
  const entries = porcelain.split("\n").filter((line) => line.trim() !== "");
  if (entries.length === 0) return undefined;
  return `the working tree has ${entries.length.toString()} uncommitted change(s); selection reads committed changes (base..HEAD), so commit first:\n${entries.slice(0, 10).join("\n")}${entries.length > 10 ? "\n..." : ""}`;
}

/** Packages that own per-platform visual snapshots among the selected ones. */
export function packagesWithPlatformSnapshots(
  selectedPackages: readonly string[],
  trackedFiles: readonly string[],
  workspaceDirs: ReadonlyMap<string, string>,
): string[] {
  const snapshots = trackedFiles.filter((file) => PLATFORM_SNAPSHOT.test(file));
  return selectedPackages.filter((name) => {
    const dir = workspaceDirs.get(name);
    return dir !== undefined && snapshots.some((file) => file.startsWith(dir));
  });
}

export function platformSnapshotWarning(
  packages: readonly string[],
  hostPlatform: string,
): string | undefined {
  if (hostPlatform === "linux" || packages.length === 0) return undefined;
  return `warning: ${packages.join(", ")} ha${packages.length === 1 ? "s" : "ve"} per-platform visual snapshots, and CI checks the Linux baselines on main. This ${hostPlatform} run uses the ${hostPlatform} ones; run \`bun run e2e:affected -- --linux\` to check the Linux baselines in the pinned ci-playwright image (needs Docker).`;
}

/** The pinned image the CI lane runs in, from the file CI reads it from. */
export function pinnedPlaywrightImage(digestFileContents: string): string {
  const digest = digestFileContents.trim();
  if (!DIGEST_PATTERN.test(digest))
    throw new Error("ci/ci-playwright/DIGEST does not hold a sha256 digest");
  return `${ciImageDefinition("ci-playwright").repository}@${digest}`;
}

const env = (name: string, value: string) => ["-e", `${name}=${value}`];

export function dockerRunArguments(options: {
  readonly image: string;
  readonly cloneDir: string;
  readonly changedBase: string;
  /** The host user, who must own what the container leaves in the clone. */
  readonly hostUser: { readonly uid: number; readonly gid: number };
}): string[] {
  const { uid, gid } = options.hostUser;
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid < 0 || gid < 0)
    throw new Error("the host uid and gid must be non-negative integers");
  return [
    "run",
    "--rm",
    "--init",
    // The CI image is published for linux/amd64 only, and CI's baselines are
    // amd64: Apple silicon hosts run it emulated.
    "--platform",
    "linux/amd64",
    "--volume",
    `${options.cloneDir}:/workspace`,
    "--volume",
    `${BUN_CACHE_VOLUME}:/bun-cache`,
    "--workdir",
    "/workspace",
    ...env("CI", "true"),
    ...env("CI_CHANGED_BASE", options.changedBase),
    ...env("CI_PLAYWRIGHT_IMAGE", options.image),
    ...env("BUN_INSTALL_LOCK_MODE", "local"),
    ...env("BUN_INSTALL_CACHE_DIR", "/bun-cache"),
    // The container runs as root (the image is built for that), so the clone
    // would fill with root-owned files that the host user cannot delete; the
    // script below hands it back to the host user on every exit.
    ...env("GIT_CONFIG_COUNT", "1"),
    ...env("GIT_CONFIG_KEY_0", "safe.directory"),
    ...env("GIT_CONFIG_VALUE_0", "/workspace"),
    options.image,
    "bash",
    "-euo",
    "pipefail",
    "-c",
    `trap 'chown -R ${uid.toString()}:${gid.toString()} /workspace' EXIT; MISE_TOOLCHAIN_SCOPE=postgres . ci/scripts/toolchain.sh && bun --no-install ${RUNNER}`,
  ];
}

/**
 * The outcome of a `--linux` run once the container has exited. The test
 * result alone decides the exit code: removing the scratch clone is
 * housekeeping, so a failure there is a warning that names the path, never a
 * test failure.
 */
export async function finishLinuxRun(
  status: number,
  cloneDir: string,
  remove: (directory: string) => Promise<void> = (directory) =>
    rm(directory, { recursive: true, force: true }),
): Promise<{ status: number; messages: string[] }> {
  if (status !== 0) {
    return {
      status,
      messages: [
        `Browser E2E (linux) failed; the clone with test results and JUnit reports is kept at ${cloneDir}`,
      ],
    };
  }
  try {
    await remove(cloneDir);
    return { status, messages: [] };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      status,
      messages: [
        `warning: the tests passed, but the scratch clone could not be removed (${reason}); delete ${cloneDir} by hand`,
      ],
    };
  }
}

async function capture(
  command: readonly string[],
  cwd = REPO_ROOT,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const child = Bun.spawn([...command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function stream(
  command: readonly string[],
  environment: Record<string, string | undefined>,
  cwd = REPO_ROOT,
): Promise<number> {
  const child = Bun.spawn([...command], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: environment,
  });
  return child.exited;
}

async function mergeBase(ref: string): Promise<string> {
  const { stdout, stderr, exitCode } = await capture([
    "git",
    "merge-base",
    "HEAD",
    ref,
  ]);
  const commit = stdout.trim();
  if (exitCode !== 0 || !/^[a-f\d]{40}$/u.test(commit)) {
    throw new Error(
      `could not find the merge base of HEAD and ${ref}; run \`git fetch origin main\` first${stderr === "" ? "" : `: ${stderr.trim()}`}`,
    );
  }
  return commit;
}

async function selectionFor(
  options: E2eAffectedOptions,
  changedBase: string,
): Promise<PlaywrightSelection> {
  if (options.all) return allPlaywrightTargets("--all requested");
  const { stdout, exitCode } = await capture([
    "git",
    "diff",
    "--no-renames",
    "--name-only",
    changedBase,
    "HEAD",
  ]);
  if (exitCode !== 0) throw new Error("git diff failed");
  return selectPlaywrightTargets(
    stdout.split("\n").filter((entry) => entry.trim() !== ""),
    REPO_ROOT,
  );
}

async function warnAboutPlatformSnapshots(
  selection: PlaywrightSelection,
): Promise<void> {
  const workspaces = await loadWorkspaces(REPO_ROOT);
  const dirs = new Map(
    [...workspaces].map(([name, workspace]) => [name, workspace.dir]),
  );
  const { stdout } = await capture(["git", "ls-files", "*.png"]);
  const owners = packagesWithPlatformSnapshots(
    selection.targets.map((target) => target.package),
    stdout.split("\n"),
    dirs,
  );
  const warning = platformSnapshotWarning(owners, process.platform);
  if (warning !== undefined) console.warn(warning);
}

async function runInLinuxImage(changedBase: string): Promise<number> {
  let dockerFailure: string | null = null;
  try {
    const docker = await capture([
      "docker",
      "version",
      "--format",
      "{{.Server.Version}}",
    ]);
    if (docker.exitCode !== 0) dockerFailure = docker.stderr.trim();
  } catch {
    dockerFailure = "docker is not installed";
  }
  if (dockerFailure !== null) {
    throw new Error(
      `--linux needs Docker, and \`docker version\` failed: ${dockerFailure}`,
    );
  }
  const image = pinnedPlaywrightImage(
    await Bun.file(path.join(REPO_ROOT, "ci/ci-playwright/DIGEST")).text(),
  );
  const { stdout: headOutput } = await capture(["git", "rev-parse", "HEAD"]);
  const head = headOutput.trim();
  // A clean clone of HEAD: the host's node_modules hold macOS binaries, and a
  // bind-mounted checkout would have the container's install overwrite them.
  const scratchRoot = path.join(REPO_ROOT, ".turbo", "e2e-affected-linux");
  await mkdir(scratchRoot, { recursive: true });
  const cloneDir = await mkdtemp(path.join(scratchRoot, "clone-"));
  for (const command of [
    ["git", "clone", "--quiet", "--no-checkout", REPO_ROOT, cloneDir],
    ["git", "-C", cloneDir, "checkout", "--quiet", "--detach", head],
  ]) {
    const result = await capture(command);
    if (result.exitCode !== 0)
      throw new Error(`${command.join(" ")} failed: ${result.stderr.trim()}`);
  }
  console.log(`Browser E2E (linux): ${image}`);
  const { getuid, getgid } = process;
  if (getuid === undefined || getgid === undefined)
    throw new Error("--linux needs a POSIX host to map file ownership");
  const container = await stream(
    [
      "docker",
      ...dockerRunArguments({
        image,
        cloneDir,
        changedBase,
        hostUser: { uid: getuid.call(process), gid: getgid.call(process) },
      }),
    ],
    Bun.env,
  );
  const { status, messages } = await finishLinuxRun(container, cloneDir);
  for (const message of messages) console.error(message);
  return status;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<number> {
  const options = parseE2eAffectedArgs(argv);
  if (!options.all || options.linux) {
    const { stdout: porcelain } = await capture([
      "git",
      "status",
      "--porcelain",
    ]);
    const dirty = dirtyTreeError(porcelain);
    if (dirty !== undefined) throw new Error(dirty);
  }
  const changedBase = options.all
    ? ""
    : await mergeBase(options.base ?? "origin/main");
  console.log(
    options.all
      ? "Browser E2E: running every project"
      : `Browser E2E: projects affected since ${changedBase}`,
  );
  if (options.linux) return runInLinuxImage(changedBase);
  await warnAboutPlatformSnapshots(await selectionFor(options, changedBase));
  return stream(
    ["bun", "--no-install", RUNNER],
    e2eAffectedEnvironment(environment, changedBase),
  );
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
