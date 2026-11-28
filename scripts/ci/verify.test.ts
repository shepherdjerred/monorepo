import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  affectedVerifyFilters,
  formatTurboFailureSummary,
  listTurboSummaryFiles,
  readNewTurboSummaries,
  ROOT_SCRIPTS_EXTERNAL_INPUTS,
} from "../verify.ts";

const REPO_ROOT = new URL("../../", import.meta.url);

test("--list-tasks prints verify's Turbo task list for toolkit ci analyze", async () => {
  const child = Bun.spawn(
    ["bun", "--no-install", "scripts/verify.ts", "--list-tasks"],
    { cwd: REPO_ROOT.pathname, stdout: "pipe", stderr: "pipe" },
  );
  const [output, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  expect(code).toBe(0);
  expect(JSON.parse(output)).toEqual(
    expect.arrayContaining(["build", "typecheck", "test:ci", "lint"]),
  );
});

describe("root scripts external inputs", () => {
  test.each(ROOT_SCRIPTS_EXTERNAL_INPUTS)("%s exists", async (input) => {
    // stat() also resolves for the directory inputs that end in "/".
    await expect(
      Bun.file(new URL(input, REPO_ROOT)).stat(),
    ).resolves.toBeDefined();
  });
});

describe("affected verification filters", () => {
  test("selects the theme consistency tests when only player docs change", async () => {
    expect(
      await affectedVerifyFilters(
        { CI_CHANGED_BASE: "abc123" },
        () => Promise.resolve(0),
        () =>
          Promise.resolve(["packages/ts-mc-docs/src/content/docs/index.md"]),
      ),
    ).toContain("--filter=@shepherdjerred/storm-theme");
  });

  test("unions the affected package graph with root invariants", async () => {
    const commands: string[][] = [];
    const filters = await affectedVerifyFilters(
      { CI_CHANGED_BASE: "abc123" },
      (command) => {
        commands.push([...command]);
        return Promise.resolve(0);
      },
      () => Promise.resolve(["packages/example/src/index.ts"]),
    );

    expect(filters).toEqual(["--filter=...[abc123]", "--filter=//"]);
    expect(commands).toEqual([
      ["git", "cat-file", "-e", "abc123^{commit}"],
      ["git", "merge-base", "--is-ancestor", "abc123", "HEAD"],
    ]);
  });

  test("selects root scripts when CI scripts change", async () => {
    expect(
      await affectedVerifyFilters(
        { CI_CHANGED_BASE: "abc123" },
        () => Promise.resolve(0),
        () => Promise.resolve(["ci/scripts/selectors/ci-changed.ts"]),
      ),
    ).toEqual([
      "--filter=...[abc123]",
      "--filter=//",
      "--filter=@shepherdjerred/root-scripts",
    ]);
  });

  test("selects root scripts when CI scripts change", async () => {
    expect(
      await affectedVerifyFilters(
        { CI_CHANGED_BASE: "abc123" },
        () => Promise.resolve(0),
        () => Promise.resolve(["ci/scripts/toolchain.sh"]),
      ),
    ).toContain("--filter=@shepherdjerred/root-scripts");
  });

  test("selects root scripts when Renovate configuration changes", async () => {
    expect(
      await affectedVerifyFilters(
        { CI_CHANGED_BASE: "abc123" },
        () => Promise.resolve(0),
        () => Promise.resolve(["renovate.json"]),
      ),
    ).toContain("--filter=@shepherdjerred/root-scripts");
  });

  test.each(["package.json", "packages/leetcode/package.json"])(
    "selects root scripts for workspace manifest %s",
    async (path) => {
      expect(
        await affectedVerifyFilters(
          { CI_CHANGED_BASE: "abc123" },
          () => Promise.resolve(0),
          () => Promise.resolve([path]),
        ),
      ).toContain("--filter=@shepherdjerred/root-scripts");
    },
  );

  test.each([
    "packages/homelab/src/cdk8s/turbo.json",
    "packages/foo/turbo.json",
  ])("selects root scripts for workspace Turbo config %s", async (path) => {
    expect(
      await affectedVerifyFilters(
        { CI_CHANGED_BASE: "abc123" },
        () => Promise.resolve(0),
        () => Promise.resolve([path]),
      ),
    ).toContain("--filter=@shepherdjerred/root-scripts");
  });

  test.each([
    "packages/discord-plays-pokemon/Dockerfile",
    "packages/streambot/Dockerfile",
    "packages/homelab/images/redlib/Dockerfile",
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
  ])("selects root scripts for Renovate fixture %s", async (path) => {
    expect(
      await affectedVerifyFilters(
        { CI_CHANGED_BASE: "abc123" },
        () => Promise.resolve(0),
        () => Promise.resolve([path]),
      ),
    ).toContain("--filter=@shepherdjerred/root-scripts");
  });

  test("runs the complete graph when changed files cannot be read", async () => {
    expect(
      await affectedVerifyFilters(
        { CI_CHANGED_BASE: "abc123" },
        () => Promise.resolve(0),
        () => Promise.resolve(undefined),
      ),
    ).toEqual([]);
  });

  test("runs the complete graph without a trustworthy base", async () => {
    expect(await affectedVerifyFilters({})).toEqual([]);
    expect(
      await affectedVerifyFilters({ CI_CHANGED_BASE: "missing" }, () =>
        Promise.resolve(1),
      ),
    ).toEqual([]);
  });

  test("fixed-corpus verification deliberately remains complete", async () => {
    let validated = false;
    expect(
      await affectedVerifyFilters(
        { CI_CHANGED_BASE: "abc123", CI_IO_FIXED_CORPUS: "true" },
        () => {
          validated = true;
          return Promise.resolve(0);
        },
      ),
    ).toEqual([]);
    expect(validated).toBe(false);
  });
});

describe("Turbo SIGTERM and non-zero failure summary diagnostics", () => {
  let directory = "";

  afterEach(async () => {
    if (directory !== "") {
      await rm(directory, { recursive: true, force: true });
      directory = "";
    }
  });

  test("formats in-flight, failed, and unstarted tasks with elapsed seconds", () => {
    const lines = formatTurboFailureSummary(
      [
        {
          tasks: [
            {
              taskId: "@shepherdjerred/ops-model#build",
              execution: { startTime: 100_000, endTime: 101_500, exitCode: 0 },
            },
            {
              taskId: "@shepherdjerred/media#test:ci",
              execution: { startTime: 100_000 },
            },
            {
              taskId: "@shepherdjerred/temporal#test:ci",
              execution: {
                startTime: 120_000,
                endTime: 150_000,
                exitCode: null,
              },
            },
            {
              taskId: "//#jscpd",
              execution: { startTime: 110_000, endTime: 125_000, exitCode: 1 },
            },
            {
              taskId: "@shepherdjerred/delivery#lint",
            },
            {
              taskId: "@shepherdjerred/delivery#test:ci",
            },
          ],
        },
      ],
      165_000,
    );

    expect(lines).toEqual([
      "[verify] Turbo in-flight task(s) (2): @shepherdjerred/media#test:ci (running 65s), @shepherdjerred/temporal#test:ci (running 45s)",
      "[verify] Turbo failed task(s) (1): //#jscpd (exit 1)",
      "[verify] Turbo unstarted task(s): 2",
    ]);
  });

  test("reads only newly written .turbo/runs/*.json summary files", async () => {
    directory = await mkdtemp(nodePath.join(tmpdir(), "verify-turbo-summary-"));
    expect([...(await listTurboSummaryFiles(directory))]).toEqual([]);

    const runsDir = nodePath.join(directory, ".turbo", "runs");
    await mkdir(runsDir, { recursive: true });
    await Bun.write(
      nodePath.join(runsDir, "previous.json"),
      JSON.stringify({
        tasks: [
          {
            taskId: "old#test:ci",
            execution: { startTime: 1000, endTime: 2000, exitCode: 2 },
          },
        ],
      }),
    );

    const before = await listTurboSummaryFiles(directory);
    expect([...before]).toEqual(["previous.json"]);

    await Bun.write(
      nodePath.join(runsDir, "current.json"),
      JSON.stringify({
        tasks: [
          {
            taskId: "@shepherdjerred/scout-for-lol#test:ci",
            execution: { startTime: 10_000 },
          },
        ],
      }),
    );
    await Bun.write(nodePath.join(runsDir, "corrupt.json"), "{not-json");

    const summaries = await readNewTurboSummaries(directory, before);
    expect(formatTurboFailureSummary(summaries, 42_000)).toEqual([
      "[verify] Turbo in-flight task(s) (1): @shepherdjerred/scout-for-lol#test:ci (running 32s)",
    ]);
  });
});
