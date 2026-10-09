import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { changedFilesSince } from "#src/github-compare.ts";
import {
  CHECK_STATUSES,
  completionStep,
  noWorkStep,
} from "#src/pipeline/completion.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
import { selectSteps } from "#src/pipeline/select.ts";
import { TEST_IDENTITY, TEST_IMAGES, testPipelineSteps } from "./identity.ts";

const SHA = "a".repeat(40);
const BASE = "b".repeat(40);
const PIPELINE = "https://woodpecker.sjer.red/repos/1/pipeline/1200";

async function check(
  states: Readonly<Record<string, string>>,
  wrongPipeline = false,
): Promise<{ code: number; stderr: string }> {
  const statuses = Object.entries(states).map(([context, state], index) => ({
    context,
    state,
    target_url: `${wrongPipeline ? PIPELINE + "-old" : PIPELINE}/${(index + 1).toString()}`,
  }));
  const source = [
    `globalThis.fetch = async () => Response.json({ statuses: ${JSON.stringify(statuses)} });`,
    CHECK_STATUSES.replace("Bun.sleep(3000)", "Bun.sleep(0)"),
  ].join("\n");
  const child = Bun.spawn(["bun", "-e", source], {
    env: {
      ...Bun.env,
      CI_EXPECTED_CONTEXTS: JSON.stringify([
        "ci/woodpecker/pr/verify",
        "ci/woodpecker/pr/pr-dryrun",
      ]),
      CI_PIPELINE_URL: PIPELINE,
      CI_REPO: "shepherdjerred/monorepo",
      CI_COMMIT_SHA: SHA,
      GITHUB_DOWNLOAD_TOKEN: "test-token",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return { code, stderr };
}

describe("cutover event selection", () => {
  test.each([
    ["push", "feature"],
    ["pull_request_metadata", "main"],
    ["pull_request_closed", "main"],
    ["manual", "feature"],
  ])("runs no substantive work for %s on %s", (event, branch) => {
    expect(
      selectSteps(testPipelineSteps(), {
        event,
        branch,
        defaultBranch: "main",
        changedFiles: [],
      }),
    ).toEqual([]);
  });

  test("uses a clone-free, tokenless workflow for ignored events", () => {
    const noWork = noWorkStep(TEST_IMAGES.base);
    const emitted: unknown = parse(emitWorkflow(noWork, TEST_IDENTITY));
    expect(emitted).toMatchObject({
      skip_clone: true,
      labels: { backend: "kubernetes" },
    });
    expect(noWork.secrets).toBeUndefined();
  });
});

describe("complete PR status", () => {
  test("browser work runs independently but completion and sites wait for both gates", () => {
    const steps = testPipelineSteps();
    const selected = selectSteps(steps, {
      event: "pull_request",
      branch: "main",
      defaultBranch: "main",
      changedFiles: ["packages/sjer.red/src/pages/index.astro"],
    });
    const browser = selected.find((step) => step.key === "playwright-e2e");
    expect(browser).toBeDefined();
    expect(browser?.dependsOn).toBeUndefined();
    const complete = completionStep(selected, TEST_IMAGES.base);
    expect(complete.dependsOn).toEqual(
      expect.arrayContaining(["verify", "playwright-e2e"]),
    );
    expect(
      JSON.parse(complete.environment?.["CI_EXPECTED_CONTEXTS"] ?? "[]"),
    ).toEqual(
      expect.arrayContaining([
        "ci/woodpecker/pr/verify",
        "ci/woodpecker/pr/playwright-e2e",
      ]),
    );
    expect(steps.find((step) => step.key === "sites")?.dependsOn).toEqual(
      expect.arrayContaining(["verify", "playwright-e2e"]),
    );
  });

  test("waits for exactly the selected blocking workflows", () => {
    const selected = testPipelineSteps().filter((step) =>
      ["verify", "pr-dryrun"].includes(step.key),
    );
    const complete = completionStep(selected, TEST_IMAGES.base);
    const emitted: unknown = parse(emitWorkflow(complete, TEST_IDENTITY));
    expect(emitted).toMatchObject({
      depends_on: ["verify", "pr-dryrun"],
      skip_clone: true,
      when: [{ status: ["success", "failure"] }],
    });
    expect(
      JSON.parse(complete.environment?.["CI_EXPECTED_CONTEXTS"] ?? "[]"),
    ).toEqual(["ci/woodpecker/pr/verify", "ci/woodpecker/pr/pr-dryrun"]);
  });

  const good = {
    "ci/woodpecker/pr/verify": "success",
    "ci/woodpecker/pr/pr-dryrun": "success",
  };

  test("passes only when both statuses belong to this pipeline", async () => {
    const success = await check(good);
    expect(success.code).toBe(0);
    const stale = await check(good, true);
    expect(stale.code).not.toBe(0);
    expect(stale.stderr).toContain("no completed status");
  });

  test("fails closed on failure or a missing status", async () => {
    const failed = await check({
      ...good,
      "ci/woodpecker/pr/verify": "failure",
    });
    expect(failed.code).not.toBe(0);
    expect(failed.stderr).toContain("Required workflows failed");
    const missing = await check({ "ci/woodpecker/pr/verify": "success" });
    expect(missing.code).not.toBe(0);
  });
});

describe("main change comparison", () => {
  test("compares from the last green commit through the current head", async () => {
    const changed = await changedFilesSince(
      "shepherdjerred/monorepo",
      BASE,
      SHA,
      async () =>
        Response.json({
          status: "ahead",
          merge_base_commit: { sha: BASE },
          files: [{ filename: "packages/scout-for-lol/src/index.ts" }],
        }),
    );
    expect(changed).toEqual(["packages/scout-for-lol/src/index.ts"]);
  });

  test("selects the full graph when ancestry or file coverage is uncertain", async () => {
    const divergent = await changedFilesSince(
      "shepherdjerred/monorepo",
      BASE,
      SHA,
      async () =>
        Response.json({
          status: "diverged",
          merge_base_commit: { sha: SHA },
          files: [],
        }),
    );
    expect(divergent).toBeUndefined();
    const truncated = await changedFilesSince(
      "shepherdjerred/monorepo",
      BASE,
      SHA,
      async () =>
        Response.json({
          status: "ahead",
          merge_base_commit: { sha: BASE },
          files: Array.from({ length: 300 }, (_, index) => ({
            filename: `f${index.toString()}`,
          })),
        }),
    );
    expect(truncated).toBeUndefined();
  });
});
