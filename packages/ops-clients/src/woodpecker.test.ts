import { describe, expect, test } from "vitest";
import { WoodpeckerClient } from "@shepherdjerred/ops-clients/woodpecker.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

function pipeline(number: number, status: string) {
  return {
    number,
    status,
    commit: `sha${String(number)}`,
    message: `commit ${String(number)}\n\nbody`,
    created: 1_790_000_000,
    finished: status === "running" ? 0 : 1_790_001_800,
  };
}

function client(fetch: ReturnType<typeof sequence>["fetch"]) {
  return new WoodpeckerClient({
    baseUrl: "https://woodpecker.sjer.red",
    token: "wp",
    repoId: 1,
    fetch,
  });
}

describe("WoodpeckerClient", () => {
  test("separates the newest pipeline from the newest verdict", async () => {
    const { fetch, requests } = sequence([
      pipeline(102, "running"),
      pipeline(101, "killed"),
      pipeline(100, "failure"),
      pipeline(99, "success"),
    ]);
    const status = await client(fetch).branchStatus("main");
    expect(status.latest).toMatchObject({ number: 102, finishedAt: undefined });
    expect(status.verdict).toMatchObject({
      number: 100,
      status: "failure",
      message: "commit 100",
      url: "https://woodpecker.sjer.red/repos/1/pipeline/100",
      finishedAt: "2026-09-21T14:43:20.000Z",
    });
    const url = new URL(requests[0]?.url ?? "");
    expect(url.pathname).toBe("/api/repos/1/pipelines");
    expect(url.searchParams.get("branch")).toBe("main");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer wp");
  });

  /**
   * Woodpecker files a pull request's pipeline under its target branch, so a
   * red pull request would otherwise read as a red main.
   */
  test("reads push pipelines only", async () => {
    const { fetch, requests } = sequence([pipeline(1, "success")]);
    await client(fetch).branchStatus("main");
    expect(new URL(requests[0]?.url ?? "").searchParams.get("event")).toBe(
      "push",
    );
  });

  test("a configuration error is a red verdict", async () => {
    const { fetch } = sequence([pipeline(5, "error"), pipeline(4, "success")]);
    const status = await client(fetch).branchStatus("main");
    expect(status.verdict).toMatchObject({ number: 5, status: "error" });
  });

  test("an unknown pipeline status fails loudly", async () => {
    const { fetch } = sequence([pipeline(1, "exploded")]);
    await expect(client(fetch).branchStatus("main")).rejects.toThrow(
      /woodpecker: response did not match schema/,
    );
  });
});

describe("WoodpeckerClient.pipeline", () => {
  test("reads workflows and steps with step URLs", async () => {
    const { fetch, requests } = sequence({
      ...pipeline(11_080, "success"),
      started: 1_790_000_010,
      event: "push",
      branch: "main",
      author: "shepherdjerred",
      forge_url: "https://github.com/shepherdjerred/monorepo/commit/abc",
      workflows: [
        {
          pid: 1,
          id: 34_000,
          name: "verify",
          state: "success",
          depends_on: ["checkout"],
          started: 1_790_000_010,
          finished: 1_790_000_100,
          children: [
            {
              pid: 15,
              name: "test",
              state: "success",
              exit_code: 0,
              started: 1_790_000_011,
              finished: 1_790_000_099,
              type: "commands",
            },
          ],
        },
        { pid: 2, name: "images", state: "pending", children: null },
      ],
    });
    const detail = await client(fetch).pipeline(11_080);
    expect(new URL(requests[0]?.url ?? "").pathname).toBe(
      "/api/repos/1/pipelines/11080",
    );
    expect(detail.workflows[0]?.steps[0]).toMatchObject({
      name: "test",
      exitCode: 0,
      url: "https://woodpecker.sjer.red/repos/1/pipeline/11080/15",
    });
    expect(detail.workflows[0]).toMatchObject({
      id: "34000",
      dependsOn: ["checkout"],
    });
    expect(detail.workflows[1]).toMatchObject({
      state: "pending",
      startedAt: undefined,
      steps: [],
    });
  });
});

describe("WoodpeckerClient dashboard reads", () => {
  test("keeps queue counts distinct and allowlists tasks", async () => {
    const queuedTask = {
      id: "34000",
      pid: 1,
      name: "verify",
      repo_id: 1,
      pipeline_id: 27,
      pipeline_number: 39,
      created: 1_790_000_000,
      dependencies: null,
      dep_status: null,
      labels: { platform: "linux/amd64" },
    };
    const { fetch, requests } = sequence({
      paused: false,
      stats: {
        pending_count: 1,
        waiting_on_deps_count: 1,
        running_count: 1,
        worker_count: 4,
      },
      pending: [queuedTask],
      waiting_on_deps: [
        {
          ...queuedTask,
          id: "34001",
          dependencies: ["34000"],
          dep_status: { "34000": "pending" },
        },
      ],
      running: [{ ...queuedTask, id: "34002", repo_id: 7 }],
    });
    const queue = await client(fetch).queue();
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/queue/info");
    expect(queue).toMatchObject({
      paused: false,
      ready: 1,
      waitingOnDependencies: 1,
      running: 1,
      workerCount: 4,
    });
    expect(queue.tasks).toHaveLength(3);
    expect(queue.tasks[0]).toEqual({
      id: "34000",
      pid: 1,
      name: "verify",
      repoId: 1,
      pipelineId: 27,
      pipelineNumber: 39,
      pipelineCreatedAt: "2026-09-21T14:13:20.000Z",
      state: "ready",
      dependencies: [],
      dependencyStates: {},
    });
    expect(queue.tasks[1]).toMatchObject({
      state: "waiting",
      dependencies: ["34000"],
      dependencyStates: { "34000": "pending" },
    });
    expect(queue.tasks[2]).toMatchObject({ state: "running", repoId: 7 });
  });

  test("reads pipeline attempt identity and decodes the stored configuration", async () => {
    const { fetch, requests } = sequence(
      [
        {
          ...pipeline(41, "success"),
          branch: "main",
          event: "pull_request_metadata",
          event_reason: ["ready_for_review"],
          ref: "refs/pull/99/head",
          rerun_count: 2,
          id: 472,
        },
      ],
      [{ name: "ci-complete.yaml", data: btoa("depends_on: [verify]\n") }],
    );
    const wp = client(fetch);
    const after = "2026-09-21T00:00:00.000Z";
    expect(
      await wp.pipelines({ page: 2, perPage: 50, status: "success", after }),
    ).toMatchObject([
      {
        id: 472,
        number: 41,
        ref: "refs/pull/99/head",
        attempt: 2,
        isDraft: false,
        eventReasons: ["ready_for_review"],
      },
    ]);
    const query = new URL(requests[0]?.url ?? "").searchParams;
    expect(Object.fromEntries(query)).toEqual({
      page: "2",
      perPage: "50",
      status: "success",
      after,
    });
    expect(await wp.pipelineConfig(41)).toEqual([
      { name: "ci-complete.yaml", data: "depends_on: [verify]\n" },
    ]);
    expect(new URL(requests[1]?.url ?? "").pathname).toBe(
      "/api/repos/1/pipelines/41/config",
    );
  });
});
