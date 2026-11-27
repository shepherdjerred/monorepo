import { expect, test } from "vitest";
import {
  formatScorecard,
  pipelineScorecard,
  spread,
  verifyPods,
  writerOf,
  writesScorecard,
  type Scorecard,
} from "#lib/ci/scorecard/scorecard.ts";
import type { Metric } from "#lib/ci/load.ts";
import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";

const sample = (labels: Record<string, string>, value: number): Metric => ({
  metric: labels,
  value: [1000, String(value)],
});

/** A ready PR: agent wait, then a verify workflow, then ci-complete. */
function readyPr(
  number: number,
  extra: Partial<WoodpeckerPipeline> = {},
): WoodpeckerPipeline {
  return {
    number,
    commit: String(number).padStart(40, "0"),
    status: "success",
    event: "pull_request",
    ref: `refs/pull/${String(number)}/head`,
    created: 1000,
    finished: 1000 + 6000,
    workflows: [
      { name: "verify", state: "success", started: 1000 + 600, finished: 6900 },
      { name: "ci-complete", state: "success", started: 6900, finished: 7000 },
    ],
    ...extra,
  };
}

function mainPush(
  number: number,
  extra: Partial<WoodpeckerPipeline> = {},
): WoodpeckerPipeline {
  return {
    number,
    commit: String(number).padStart(40, "f"),
    status: "success",
    event: "push",
    branch: "main",
    ref: "refs/heads/main",
    created: 1000,
    finished: 1000 + 1200,
    workflows: ["verify", "images", "helm-push", "delivery-publish"].map(
      (name) => ({ name, state: "success", started: 1100, finished: 2000 }),
    ),
    ...extra,
  };
}

test("percentiles use nearest rank and skip missing samples", () => {
  expect(spread([10, 20, null, 30, 40, 50, 60, 70, 80, 90, 100])).toEqual({
    count: 10,
    p50Seconds: 50,
    p90Seconds: 90,
  });
  expect(spread([])).toEqual({ count: 0, p50Seconds: null, p90Seconds: null });
});

test("joins verify pod gate time to the pipeline that created it", () => {
  const pods = verifyPods(
    [
      sample({ pod: "wp-a", label_ci_sjer_red_commit: readyPr(1).commit }, 900),
      sample(
        { pod: "wp-other", label_ci_sjer_red_commit: readyPr(2).commit },
        50,
      ),
      sample({ pod: "wp-orphan", label_ci_sjer_red_commit: "x" }, 5),
    ],
    [sample({ pod: "wp-a" }, 1700), sample({ pod: "wp-other" }, 9_999_999)],
  );
  expect(pods.map((pod) => pod.pod)).toEqual(["wp-a", "wp-other"]);
  const card = pipelineScorecard([readyPr(1), readyPr(2)], pods, 0, 10_000);
  // wp-other was created long after pipeline 2 ended: not its gate.
  expect(card.readyPr.kueueGate).toEqual({
    count: 1,
    p50Seconds: 900,
    p90Seconds: 900,
  });
});

test("splits ready-PR end to end into agent wait, gate and run; main pushes stay apart", () => {
  const pods = verifyPods(
    [sample({ pod: "wp-a", label_ci_sjer_red_commit: readyPr(1).commit }, 900)],
    [sample({ pod: "wp-a" }, 1700)],
  );
  const card = pipelineScorecard(
    [
      readyPr(1),
      // Failed and killed: only the failure has a verdict.
      readyPr(2, { status: "failure" }),
      readyPr(3, { status: "killed" }),
      readyPr(4, { status: "pending", finished: 0 }),
      mainPush(5),
      mainPush(6, { status: "canceled" }),
    ],
    pods,
    0,
    10_000,
  );
  expect(card.readyPr.finished).toBe(2);
  expect(card.readyPr.failed).toBe(1);
  expect(card.readyPr.failedShare).toBe(0.5);
  expect(card.readyPr.endToEnd.p50Seconds).toBe(6000);
  expect(card.readyPr.agentWait.p50Seconds).toBe(600);
  expect(card.readyPr.kueueGate.count).toBe(1);
  expect(card.readyPr.run.p50Seconds).toBe(6000 - 600 - 900);
  expect(card.main).toMatchObject({ finished: 1 });
  expect(card.main.endToEnd.p50Seconds).toBe(1200);
});

test("gives each pod of a restarted commit to the pipeline that created it", () => {
  const commit = "c".repeat(40);
  const first = readyPr(1, { commit, created: 1000, finished: 8000 });
  const second = readyPr(2, { commit, created: 3000, finished: 9000 });
  const pods = [
    { pod: "wp-first", commit, createdAt: 1700, gateSeconds: 100 },
    { pod: "wp-second", commit, createdAt: 3700, gateSeconds: 700 },
  ];
  const card = pipelineScorecard([first, second], pods, 0, 10_000);
  // Each pipeline sees its own pod's gate, not the sum of both.
  expect(card.readyPr.kueueGate.count).toBe(2);
  expect(card.readyPr.kueueGate.p50Seconds).toBe(100);
  expect(card.readyPr.kueueGate.p90Seconds).toBe(700);
});

test("assigns each pool claim to one writer", () => {
  expect(writerOf("woodpecker-ci", "ci-workspace")).toBe("workspaces");
  expect(writerOf("buildkitd", "zfs-ssd-lz4")).toBe("buildkit");
  expect(writerOf("delivery-worker-jobs", "zfs-ssd-lz4")).toBe("delivery");
  expect(writerOf("turbo-cache", "zfs-ssd-lz4")).toBe("caches");
  // Cache claims in the CI namespace are not workspaces.
  expect(writerOf("woodpecker-ci", "zfs-ssd-lz4")).toBe("caches");
});

test("sums workspace writes from the counter maximum and the rest from increase", () => {
  const writes = writesScorecard(
    [
      sample(
        { namespace: "woodpecker-ci", storageclass: "ci-workspace" },
        300e9,
      ),
      // A long-lived claim's lifetime counter is not its 24h writes.
      sample({ namespace: "buildkitd", storageclass: "zfs-ssd-lz4" }, 9000e9),
    ],
    [
      sample({ namespace: "woodpecker-ci", storageclass: "ci-workspace" }, 1e9),
      sample({ namespace: "buildkitd", storageclass: "zfs-ssd-lz4" }, 90e9),
      sample({ namespace: "delivery-worker-jobs", storageclass: "x" }, 60e9),
      sample({ namespace: "turbo-cache", storageclass: "x" }, 10e9),
      sample({ namespace: "ci-cache", storageclass: "x" }, 5e9),
    ],
    400e9,
  );
  const gigabytes = Object.fromEntries(
    writes.writers.map((row) => [row.writer, row.gigabytes]),
  );
  expect(gigabytes).toEqual({
    workspaces: 300,
    buildkit: 90,
    delivery: 60,
    caches: 15,
  });
  expect(writes.writers.filter((row) => row.overBudget)).toEqual([
    expect.objectContaining({ writer: "workspaces", budgetGigabytes: 250 }),
    expect.objectContaining({ writer: "delivery", budgetGigabytes: 50 }),
  ]);
  expect(writes.totalGigabytes).toBe(465);
  expect(writes.overTotalBudget).toBe(false);
  expect(writes.poolPhysicalGigabytes).toBe(400);
});

test("prints each section, reporting an unavailable source in place", () => {
  const writes = writesScorecard([], [], null);
  const report: Scorecard = {
    schemaVersion: 1,
    window: { since: "a", until: "b" },
    pipelines: 3,
    latency: {
      available: true,
      data: {
        ...pipelineScorecard([readyPr(1)], [], 0, 10_000),
        gateError: "no samples",
      },
    },
    queue: { available: false, error: "queue down" },
    writes: { available: true, data: writes },
  };
  const text = formatScorecard(report);
  expect(text).toContain("end to end");
  expect(text).toContain("gate unavailable: no samples");
  expect(text).toContain("Woodpecker queue unavailable: queue down");
  expect(text).toContain("workspaces");
  expect(text).toContain("pool physical writes: unavailable");
});
