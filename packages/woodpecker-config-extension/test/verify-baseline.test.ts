import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifyCommands } from "#src/pipeline/steps.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});

async function fixture(initialOnly = false) {
  const root = await mkdtemp(path.join(tmpdir(), "verify-baseline-"));
  roots.push(root);
  const origin = path.join(root, "origin");
  const checkout = path.join(root, "checkout");
  const env = {
    PATH: Bun.env["PATH"],
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
  const run = (args: string[], cwd = root) => {
    const child = Bun.spawnSync(args, {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (child.exitCode !== 0)
      throw new Error(new TextDecoder().decode(child.stderr));
    return new TextDecoder().decode(child.stdout).trim();
  };
  run(["git", "init", "--initial-branch=main", origin]);
  const commit = (message: string) =>
    run(
      [
        "git",
        "-c",
        "user.name=CI fixture",
        "-c",
        "user.email=ci@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        message,
      ],
      origin,
    );
  commit("initial");
  const parent = run(["git", "rev-parse", "HEAD"], origin);
  run(["git", "checkout", "-b", "ci-canary/ram"], origin);
  if (!initialOnly) commit("canary");
  const source = run(["git", "rev-parse", "HEAD"], origin);
  run(["git", "checkout", "main"], origin);
  if (!initialOnly) commit("independent main");
  run([
    "git",
    "clone",
    "--depth=1",
    "--single-branch",
    "--branch=ci-canary/ram",
    pathToFileURL(origin).href,
    checkout,
  ]);
  return { checkout, env, parent, source, run };
}

async function baseline(initialOnly = false) {
  const setup = await fixture(initialOnly);
  const commands = verifyCommands({
    remoteCache: false,
    publishHandoff: false,
  });
  const end = commands.findIndex((command) =>
    command.startsWith("export TURBO_CACHE="),
  );
  if (end < 2) throw new Error("Verification Git preflight missing");
  const child = Bun.spawnSync(
    [
      "bash",
      "-euo",
      "pipefail",
      "-c",
      [
        ...commands.slice(2, end),
        String.raw`printf "%s\n" "$TASKNOTES_COVERAGE_BASE"`,
      ].join("\n"),
    ],
    {
      cwd: setup.checkout,
      env: {
        ...setup.env,
        CI_REPO_DEFAULT_BRANCH: "main",
        CI_PIPELINE_EVENT: "manual",
        CI_COMMIT_SHA: setup.source,
        CI_CHANGED_BASE: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return {
    ...setup,
    child,
    value: new TextDecoder().decode(child.stdout).trim(),
  };
}

test("a depth-one frozen canary resolves its own predecessor after main diverges", async () => {
  const result = await baseline();
  expect(result.child.exitCode).toBe(0);
  expect(result.value).toBe(result.parent);
  // The predecessor must be usable for the coverage gate's actual diff.
  expect(
    result.run(
      ["git", "diff", "--name-only", `${result.value}...HEAD`],
      result.checkout,
    ),
  ).toBe("");
});

test("a source without a predecessor fails before exporting an empty baseline", async () => {
  const result = await baseline(true);
  expect(result.child.exitCode).not.toBe(0);
  expect(result.value).toBe("");
  expect(new TextDecoder().decode(result.child.stderr)).toContain(
    "Needed a single revision",
  );
});
