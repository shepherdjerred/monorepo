import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { draftPreflightStep } from "#src/pipeline/draft.ts";
import {
  GIT_MAINTENANCE_OFF,
  goldenHistoryCommands,
  SHALLOW_HISTORY_DEPTH,
} from "#src/pipeline/git-history.ts";
import { playwrightSteps } from "#src/pipeline/lanes/playwright.ts";
import { maintenanceSteps } from "#src/pipeline/maintenance.ts";
import { verifyCommands } from "#src/pipeline/steps.ts";
import { TEST_IMAGES } from "#test-identity";

const depth = `--depth=${SHALLOW_HISTORY_DEPTH.toString()}`;
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});

const verify = verifyCommands({ remoteCache: false, publishHandoff: false });

test("every history fetch uses the depth the golden workspace holds, after maintenance is off", () => {
  const playwright = playwrightSteps(TEST_IMAGES)[0]?.commands ?? [];
  const draft = draftPreflightStep(TEST_IMAGES).commands;
  // The browser step runs its body through one diagnostics wrapper command.
  for (const commands of [verify, playwright, draft]) {
    const script = commands.join("\n");
    const fetches = script
      .split("\n")
      .flatMap((line) => line.match(/git fetch [^&;'\n]*/gu) ?? [])
      .filter((fetch) => !fetch.includes("--depth=2 "));
    expect(fetches.length).toBeGreaterThan(0);
    for (const fetch of fetches) expect(fetch).toContain(depth);
    expect(script).not.toMatch(/--depth=(?!100\b|2\b)\d+/u);
    const firstFetch = script.indexOf("git fetch");
    for (const off of GIT_MAINTENANCE_OFF) {
      expect(script).toContain(off);
      expect(script.indexOf(off)).toBeLessThan(firstFetch);
    }
  }
});

test("the golden refresh fetches its history by commit, names it, and compacts before publishing", () => {
  const commands = maintenanceSteps(TEST_IMAGES, "workspace-golden")[0]
    ?.commands;
  if (commands === undefined) throw new Error("golden step missing");
  const install = commands.indexOf(
    "ci/scripts/bun-install.sh --frozen-lockfile",
  );
  const publish = commands.findIndex((command) =>
    command.includes("publish-workspace-golden.ts"),
  );
  expect(commands.slice(install + 1, publish)).toEqual(goldenHistoryCommands());
  expect(goldenHistoryCommands()).toEqual([
    ...GIT_MAINTENANCE_OFF,
    `git fetch --no-tags ${depth} origin "$(git rev-parse HEAD)"`,
    'git update-ref "refs/remotes/origin/$CI_REPO_DEFAULT_BRANCH" HEAD',
    "git reflog expire --expire=now --all",
    "git gc --prune=now --quiet",
  ]);
});

const env = {
  PATH: Bun.env["PATH"],
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "CI fixture",
  GIT_AUTHOR_EMAIL: "ci@example.invalid",
  GIT_COMMITTER_NAME: "CI fixture",
  GIT_COMMITTER_EMAIL: "ci@example.invalid",
};

function run(args: string[], cwd: string, extra: Record<string, string> = {}) {
  const child = Bun.spawnSync(args, {
    cwd,
    env: { ...env, HOME: cwd, ...extra },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (child.exitCode !== 0)
    throw new Error(
      `${args.join(" ")}: ${new TextDecoder().decode(child.stderr)}`,
    );
  return new TextDecoder().decode(child.stdout).trim();
}

async function objectBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await objectBytes(entryPath);
    else {
      const info = await stat(entryPath);
      total += info.size;
    }
  }
  return total;
}

/**
 * An origin whose every commit rewrites a large, incompressible file, so the
 * history behind the tip costs real bytes to send.
 */
async function origin(root: string) {
  const repository = path.join(root, "origin");
  run(["git", "init", "--initial-branch=main", repository], root);
  const commit = async (name: string, payloadBytes = 256 * 1024) => {
    await writeFile(
      path.join(repository, "payload.bin"),
      crypto.getRandomValues(new Uint8Array(payloadBytes)),
    );
    await writeFile(path.join(repository, `${name}.txt`), name);
    run(["git", "add", "-A"], repository);
    run(["git", "commit", "-m", name], repository);
    return run(["git", "rev-parse", "HEAD"], repository);
  };
  return { repository, commit };
}

type ScenarioOptions = {
  readonly golden: "history" | "depth-one";
  /** The commit the step checks out: a pull request head, or the golden commit itself. */
  readonly checkout?: "pull-request" | "golden-commit";
  /** Commits main gains after the golden was built, before the pull request. */
  readonly mainAhead?: number;
};

async function scenario(options: ScenarioOptions) {
  const { golden, checkout = "pull-request", mainAhead = 2 } = options;
  const root = await mkdtemp(path.join(tmpdir(), "git-history-"));
  roots.push(root);
  const { repository, commit } = await origin(root);
  for (let index = 0; index < 8; index++)
    await commit(`old-${index.toString()}`);
  const goldenCommit = await commit("golden");
  const url = pathToFileURL(repository).href;
  const workspace = path.join(root, "workspace");
  // The golden is built the way checkout/snapshot.ts builds it.
  run(["git", "init", "--quiet", workspace], root);
  run(["git", "remote", "add", "origin", url], workspace);
  run(
    [
      "git",
      "fetch",
      "--no-tags",
      "--depth=1",
      "--no-filter",
      "origin",
      `+${goldenCommit}:`,
    ],
    workspace,
  );
  run(["git", "reset", "--hard", "--quiet", goldenCommit], workspace);
  if (golden === "history")
    run(
      ["bash", "-euo", "pipefail", "-c", goldenHistoryCommands().join("\n")],
      workspace,
      {
        CI_REPO_DEFAULT_BRANCH: "main",
      },
    );
  if (golden === "history") {
    // Every clone inherits this before its own first fetch.
    expect(run(["git", "config", "--get", "gc.auto"], workspace)).toBe("0");
    expect(run(["git", "config", "--get", "maintenance.auto"], workspace)).toBe(
      "false",
    );
  }
  // Main advances past the golden. A pull request branched from main two
  // commits before its tip, which is the golden itself when main moved twice.
  for (let index = 1; index <= mainAhead; index++)
    await commit(`main-${index.toString()}`, mainAhead > 10 ? 4096 : undefined);
  const target = run(["git", "rev-parse", "main"], repository);
  let head = goldenCommit;
  if (checkout === "pull-request") {
    run(["git", "checkout", "-b", "feature", "main~1"], repository);
    head = await commit("feature");
    run(["git", "checkout", "main"], repository);
  }
  const copy = path.join(root, "clone");
  run(["cp", "-R", workspace, copy], root);
  // checkout/snapshot.ts: an eager depth-one fetch of the requested commit.
  run(
    [
      "git",
      "fetch",
      "--no-tags",
      "--depth=1",
      "--no-filter",
      "origin",
      `+${head}:`,
    ],
    copy,
  );
  run(["git", "reset", "--hard", "--quiet", head], copy);
  const shallowFile = await readFile(
    path.join(copy, ".git", "shallow"),
    "utf8",
  );
  const shallowAfterCheckout = shallowFile.trim().split("\n");
  const before = await objectBytes(path.join(copy, ".git", "objects"));
  const start = verify.indexOf(GIT_MAINTENANCE_OFF[0]);
  const end = verify.findIndex((command) =>
    command.startsWith("export TURBO_CACHE="),
  );
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const output = run(
    [
      "bash",
      "-euo",
      "pipefail",
      "-c",
      [
        ...verify.slice(start, end),
        'printf "%s\\n" "${CI_CHANGED_BASE-}"',
      ].join("\n"),
    ],
    copy,
    {
      CI_REPO_DEFAULT_BRANCH: "main",
      CI_PIPELINE_EVENT: "pull_request",
      CI_COMMIT_SHA: head,
      CI_COMMIT_TARGET_BRANCH: "main",
    },
  );
  const written =
    (await objectBytes(path.join(copy, ".git", "objects"))) - before;
  return {
    copy,
    output,
    written,
    tip: target,
    target,
    head,
    goldenCommit,
    shallowAfterCheckout,
  };
}

type Result = Awaited<ReturnType<typeof scenario>>;

/**
 * The predecessor is the pull request's merge base, and every commit the
 * changed-file diff walks is present, exactly as without the golden history.
 */
function expectSameCorrectness(result: Result, changed: string) {
  const base = run(
    ["git", "merge-base", result.head, result.target],
    result.copy,
  );
  expect(result.output.split("\n").at(-1)).toBe(base);
  expect(
    run(["git", "rev-parse", "refs/remotes/origin/main"], result.copy),
  ).toBe(result.target);
  expect(run(["git", "diff", "--name-only", base, "HEAD"], result.copy)).toBe(
    changed,
  );
  run(["git", "fsck", "--connectivity-only", "--no-dangling"], result.copy);
}

function commitCount(result: Result, ref: string) {
  return run(["git", "rev-list", "--count", ref], result.copy);
}

test("a clone of the golden fetches only commits newer than it, with the same history", async () => {
  const depthOne = await scenario({ golden: "depth-one" });
  const history = await scenario({ golden: "history" });

  // The history the golden carries is not sent again. The sixteen blobs behind
  // the golden are about 4 MiB; what remains is the two new main commits.
  expect(depthOne.written).toBeGreaterThan(1024 * 1024);
  expect(history.written).toBeLessThan(depthOne.written / 4);

  for (const result of [depthOne, history])
    expectSameCorrectness(result, "feature.txt\npayload.bin");
  expect(commitCount(history, "HEAD")).toBe(commitCount(depthOne, "HEAD"));
  expect(commitCount(history, "refs/remotes/origin/main")).toBe(
    commitCount(depthOne, "refs/remotes/origin/main"),
  );
}, 60_000);

test("the checkout's depth-one fetch of the golden commit makes it a boundary again but keeps the benefit", async () => {
  const depthOne = await scenario({
    golden: "depth-one",
    checkout: "golden-commit",
  });
  const history = await scenario({
    golden: "history",
    checkout: "golden-commit",
  });

  // The reviewer's concern, checked directly: the depth-one fetch of a commit
  // the golden already holds rewrites .git/shallow to that commit alone.
  expect(history.shallowAfterCheckout).toEqual([history.goldenCommit]);

  // The objects behind the boundary are still in the object store, and the
  // golden's origin/main names the tip, so negotiation still finds them: only
  // the two new main commits are sent.
  expect(history.written).toBeLessThan(depthOne.written / 4);
  for (const result of [depthOne, history]) expectSameCorrectness(result, "");
}, 60_000);

test("a main more than one fetch depth ahead of the golden stays correct and costs no more than without it", async () => {
  const mainAhead = SHALLOW_HISTORY_DEPTH + 5;
  const depthOne = await scenario({ golden: "depth-one", mainAhead });
  const history = await scenario({ golden: "history", mainAhead });

  // The golden's tip is past the window, so nothing it holds is negotiated for
  // free. Transfer is the window itself either way, within pack-header noise.
  expect(history.written).toBeLessThan(depthOne.written * 1.1);
  expect(history.written).toBeGreaterThan(depthOne.written * 0.9);

  // The pull request branched inside the window, so the merge base is found
  // and the changed files are those the pull request made.
  for (const result of [depthOne, history])
    expectSameCorrectness(result, "feature.txt\npayload.bin");
  expect(commitCount(history, "HEAD")).toBe(commitCount(depthOne, "HEAD"));
}, 120_000);
