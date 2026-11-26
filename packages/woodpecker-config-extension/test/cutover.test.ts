import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
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

type CommitStatus = {
  context: string;
  state: string;
  description?: string;
  target_url: string;
};

type CheckResult = {
  code: number;
  stderr: string;
  sleeps: number[];
  ifNoneMatchHeaders: (string | null)[];
};

async function check(
  states: Readonly<Record<string, string>>,
  wrongPipeline = false,
  pageSize = 100,
): Promise<CheckResult> {
  const statuses = Object.entries(states).map(([context, state], index) => ({
    context,
    state,
    target_url: `${wrongPipeline ? PIPELINE + "-old" : PIPELINE}/${(index + 1).toString()}`,
  }));
  return runCheckStatuses([statuses], pageSize);
}

type WoodpeckerPipelineMock = {
  number: number;
  commit: string;
  workflows: readonly { name: string; state: string }[];
};

/** Runs the ci-complete script against a paginated GitHub statuses fake. */
async function runCheckStatuses(
  timeline: readonly (readonly CommitStatus[])[],
  pageSize: number,
  useEtags = false,
  woodpeckerPipeline?: WoodpeckerPipelineMock,
): Promise<CheckResult> {
  const source = [
    `const timeline = ${JSON.stringify(timeline)};`,
    `const pageSize = ${String(pageSize)};`,
    `const useEtags = ${String(useEtags)};`,
    `const woodpeckerPipeline = ${JSON.stringify(woodpeckerPipeline ?? null)};`,
    `const sleeps = [];`,
    `const ifNoneMatchHeaders = [];`,
    `let pollIndex = 0;`,
    `Bun.sleep = async (ms) => { sleeps.push(ms); pollIndex += 1; };`,
    String.raw`process.on("exit", () => { console.error("\n__META__:" + JSON.stringify({ sleeps, ifNoneMatchHeaders }) + "\n"); });`,
    `globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname !== "api.github.com") {
        if (!woodpeckerPipeline || url.pathname !== "/api/repos/1/pipelines/1200") {
          return new Response("not found", { status: 404 });
        }
        return Response.json(woodpeckerPipeline);
      }
      const page = Number(url.searchParams.get("page") ?? "1");
      const statuses = timeline[Math.min(pollIndex, timeline.length - 1)];
      const start = (page - 1) * pageSize;
      const slice = statuses.slice(start, start + pageSize);
      const reqHeaders = new Headers(init?.headers);
      const inm = reqHeaders.get("if-none-match");
      ifNoneMatchHeaders.push(inm);
      const etag = 'W/"' + Bun.hash(JSON.stringify(slice)).toString(16) + '"';
      if (useEtags && inm === etag) {
        return new Response(null, { status: 304 });
      }
      const headers = new Headers();
      if (useEtags) headers.set("etag", etag);
      if (start + pageSize < statuses.length) {
        url.searchParams.set("page", String(page + 1));
        headers.set("link", "<" + url.toString() + '>; rel="next"');
      }
      return new Response(JSON.stringify(slice), { headers });
    };`,
    CHECK_STATUSES,
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
  const [code, rawStderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  const metaMatch = /^__META__:(.+)$/mu.exec(rawStderr);
  if (metaMatch?.[1] === undefined) {
    return { code, stderr: rawStderr, sleeps: [], ifNoneMatchHeaders: [] };
  }
  const meta = z
    .object({
      sleeps: z.array(z.number()),
      ifNoneMatchHeaders: z.array(z.string().nullable()),
    })
    .parse(JSON.parse(metaMatch[1]));
  return {
    code,
    stderr: rawStderr.replaceAll(/^__META__:.+$/gmu, ""),
    sleeps: meta.sleeps,
    ifNoneMatchHeaders: meta.ifNoneMatchHeaders,
  };
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

  test("manual no-work receipts use a clone-free, tokenless workflow", () => {
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
  test.each([
    "packages/delivery/src/client/app.tsx",
    "packages/delivery/e2e/delivery.spec.ts",
    "packages/delivery/prisma/schema.prisma",
  ])("requires browser acceptance for Delivery-only change %s", (path) => {
    const selected = selectSteps(testPipelineSteps(), {
      event: "pull_request",
      branch: "feature/delivery",
      defaultBranch: "main",
      changedFiles: [path],
    });
    expect(selected.some((step) => step.key === "playwright-e2e")).toBe(true);
    expect(completionStep(selected, TEST_IMAGES.base).dependsOn).toContain(
      "playwright-e2e",
    );
  });

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
    expect(complete.timeoutMinutes).toBe(95);
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
});

describe("complete PR status polling", () => {
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

  test("reads a success that is only on a later page and ignores an older failure", async () => {
    const paged = await check(good, false, 1);
    expect(paged.code).toBe(0);

    const staleNewer = [
      {
        context: "ci/woodpecker/pr/verify",
        state: "success",
        target_url: `${PIPELINE}/9`,
      },
      {
        context: "ci/woodpecker/pr/pr-dryrun",
        state: "success",
        target_url: `${PIPELINE}/8`,
      },
      {
        context: "ci/woodpecker/pr/verify",
        state: "failure",
        target_url: `${PIPELINE}/1`,
      },
    ];
    const newest = await runCheckStatuses([staleNewer], 1);
    expect(newest.code).toBe(0);
  });

  test("fails closed immediately on failure, error, or terminal Woodpecker descriptions", async () => {
    for (const badState of ["failure", "error"]) {
      const failed = await check({
        ...good,
        "ci/woodpecker/pr/verify": badState,
      });
      expect(failed.code).not.toBe(0);
      expect(failed.sleeps).toEqual([]);
      expect(failed.stderr).toContain("Required workflows failed");
    }

    for (const description of [
      "Pipeline was canceled",
      "Pipeline was skipped",
      "Pipeline was rejected",
    ]) {
      const terminal = await runCheckStatuses(
        [
          [
            {
              context: "ci/woodpecker/pr/verify",
              state: "pending",
              description,
              target_url: `${PIPELINE}/1`,
            },
            {
              context: "ci/woodpecker/pr/pr-dryrun",
              state: "success",
              target_url: `${PIPELINE}/2`,
            },
          ],
        ],
        100,
      );
      expect(terminal.code).not.toBe(0);
      expect(terminal.sleeps).toEqual([]);
      expect(terminal.stderr).toContain("Required workflows failed");
    }
  });

  test("fails after 60s (20 * 3s) when an expected context is missing", async () => {
    const missing = await check({ "ci/woodpecker/pr/verify": "success" });
    expect(missing.code).not.toBe(0);
    expect(missing.sleeps).toEqual(Array.from({ length: 20 }, () => 3000));
    expect(missing.stderr).toContain("no completed status");
  });

  test("continues polling every 10s while running or pending and caches pages via ETag", async () => {
    const runningPoll = [
      {
        context: "ci/woodpecker/pr/verify",
        state: "pending",
        description: "Pipeline is running",
        target_url: `${PIPELINE}/1`,
      },
      {
        context: "ci/woodpecker/pr/pr-dryrun",
        state: "pending",
        description: "Pipeline is pending",
        target_url: `${PIPELINE}/2`,
      },
    ];
    const finishedPoll = [
      {
        context: "ci/woodpecker/pr/verify",
        state: "success",
        description: "Pipeline was successful",
        target_url: `${PIPELINE}/1`,
      },
      {
        context: "ci/woodpecker/pr/pr-dryrun",
        state: "success",
        description: "Pipeline was successful",
        target_url: `${PIPELINE}/2`,
      },
    ];
    // 10 polls * 10s = 100s (> 60s missing timeout), with pageSize=1 to exercise
    // multi-page Link preservation across HTTP 304 Not Modified responses.
    const timeline = [
      ...Array.from({ length: 10 }, () => runningPoll),
      finishedPoll,
    ];
    const eventual = await runCheckStatuses(timeline, 1, true);
    expect(eventual.code).toBe(0);
    expect(eventual.sleeps).toEqual(Array.from({ length: 10 }, () => 10_000));
    expect(eventual.ifNoneMatchHeaders.slice(0, 2)).toEqual([null, null]);
    expect(
      eventual.ifNoneMatchHeaders.slice(2).every((value) => value !== null),
    ).toBe(true);
  });

  test("bounds active pending waits at 5400s", async () => {
    const stuckRunning = await runCheckStatuses(
      [
        [
          {
            context: "ci/woodpecker/pr/verify",
            state: "pending",
            description: "Pipeline is running",
            target_url: `${PIPELINE}/1`,
          },
          {
            context: "ci/woodpecker/pr/pr-dryrun",
            state: "success",
            target_url: `${PIPELINE}/2`,
          },
        ],
      ],
      100,
      true,
    );
    expect(stuckRunning.code).not.toBe(0);
    expect(stuckRunning.sleeps).toHaveLength(540);
    expect(stuckRunning.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(
      5_400_000,
    );
    expect(stuckRunning.stderr).toContain("no completed status");
  });
});

describe("complete PR status Woodpecker reconciliation", () => {
  test("reconciles dropped terminal GitHub statuses via Woodpecker pipeline state", async () => {
    const okPipeline: WoodpeckerPipelineMock = {
      number: 1200,
      commit: SHA,
      workflows: [
        { name: "verify", state: "success" },
        { name: "pr-dryrun", state: "success" },
      ],
    };
    const verifyOk = {
      context: "ci/woodpecker/pr/verify",
      state: "success",
      target_url: `${PIPELINE}/1`,
    };
    const stuckPending = {
      context: "ci/woodpecker/pr/pr-dryrun",
      state: "pending",
      description: "Workflow is running",
      target_url: `${PIPELINE}/2`,
    };
    const droppedPending = await runCheckStatuses(
      [[verifyOk, stuckPending]],
      100,
      false,
      okPipeline,
    );
    expect(droppedPending.code).toBe(0);
    expect(droppedPending.sleeps).toEqual([]);

    const droppedMissing = await runCheckStatuses(
      [[verifyOk]],
      100,
      false,
      okPipeline,
    );
    expect(droppedMissing.code).toBe(0);
    expect(droppedMissing.sleeps).toEqual(
      Array.from({ length: 20 }, () => 3000),
    );
  });

  test("rejects Woodpecker reconciliation on commit mismatch or failed workflow", async () => {
    const partial = [
      [
        {
          context: "ci/woodpecker/pr/verify",
          state: "success",
          target_url: `${PIPELINE}/1`,
        },
        {
          context: "ci/woodpecker/pr/pr-dryrun",
          state: "pending",
          description: "Workflow is running",
          target_url: `${PIPELINE}/2`,
        },
      ],
    ];
    const wrongCommit = await runCheckStatuses(partial, 100, false, {
      number: 1200,
      commit: BASE,
      workflows: [
        { name: "verify", state: "success" },
        { name: "pr-dryrun", state: "success" },
      ],
    });
    expect(wrongCommit.code).not.toBe(0);
    expect(wrongCommit.stderr).toContain("no completed status");

    const failedWorkflow = await runCheckStatuses(partial, 100, false, {
      number: 1200,
      commit: SHA,
      workflows: [
        { name: "verify", state: "success" },
        { name: "pr-dryrun", state: "canceled" },
      ],
    });
    expect(failedWorkflow.code).not.toBe(0);
    expect(failedWorkflow.sleeps).toEqual([]);
    expect(failedWorkflow.stderr).toContain("Required workflows failed");
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
