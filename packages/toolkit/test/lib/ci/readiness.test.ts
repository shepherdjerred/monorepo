import { describe, expect, test } from "vitest";
import {
  evaluateReadiness,
  pipelineState,
  EXIT_CODES,
} from "#lib/ci/readiness.ts";
import { mainVerdict } from "#lib/ci/main.ts";
import { ciFixture, pendingCi, CI_HEAD } from "./fixtures.ts";

describe("merge readiness", () => {
  test("a green draft cannot satisfy readiness after the PR becomes ready", () => {
    const snapshot = ciFixture();
    if (snapshot.pipeline === null) throw new Error("Missing fixture");
    snapshot.pipeline.pr_draft = true;
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("waiting");
    snapshot.pipeline.pr_draft = false;
    snapshot.pipeline.workflows.push({
      name: "draft-preflight",
      state: "success",
    });
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("waiting");
  });

  test("ready-event completion still requires a status from that exact pipeline", () => {
    const snapshot = ciFixture();
    if (snapshot.pipeline === null) throw new Error("Missing fixture");
    snapshot.pipeline.event = "pull_request_metadata";
    snapshot.pipeline.event_reason = ["ready_for_review"];
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("ready");
    snapshot.pipeline.number = 8;
    snapshot.pipelineUrl = "https://woodpecker.sjer.red/repos/1/pipeline/8";
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("waiting");
    snapshot.pipeline.workflows = [{ name: "ci-noop", state: "success" }];
    expect(pipelineState(snapshot.pipeline)).toBe("pending");
  });
  test("approval-free rules allow an empty review decision and non-strict behind branch", () => {
    const snapshot = ciFixture();
    snapshot.pr.mergeable_state = "behind";
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("ready");
    snapshot.rules.strict = true;
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("failure");
  });
  test("an early workflow failure returns while sibling checks still run", () => {
    const snapshot = pendingCi();
    snapshot.pipeline?.workflows.push({ name: "lint", state: "failure" });
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("failure");
    expect(evaluateReadiness(snapshot, CI_HEAD, "settled").outcome).toBe(
      "waiting",
    );
    snapshot.pipeline = {
      number: 7,
      commit: CI_HEAD,
      status: "failure",
      workflows: [
        { name: "lint", state: "failure" },
        { name: "ci-complete", state: "failure" },
      ],
    };
    snapshot.checks[0] = {
      name: "ci/merge-conflict",
      state: "pass",
      url: null,
      appId: null,
    };
    expect(evaluateReadiness(snapshot, CI_HEAD, "settled").outcome).toBe(
      "failure",
    );
  });
  test("settled mode waits for unfinished siblings even when the pipeline already says failure", () => {
    const snapshot = pendingCi();
    snapshot.pipeline = {
      number: 7,
      commit: CI_HEAD,
      status: "failure",
      workflows: [
        { name: "lint", state: "failure" },
        { name: "tests", state: "running" },
        { name: "ci-complete", state: "failure" },
      ],
    };
    snapshot.checks[0] = {
      name: "ci/merge-conflict",
      state: "pass",
      url: null,
      appId: null,
    };
    expect(evaluateReadiness(snapshot, CI_HEAD, "settled").outcome).toBe(
      "waiting",
    );
  });
  test("service cleanup failures and unfinished optional work do not veto a successful gate", () => {
    const snapshot = ciFixture();
    snapshot.pipeline = {
      number: 7,
      commit: CI_HEAD,
      status: "running",
      workflows: [
        { name: "ci-complete", state: "success" },
        {
          name: "docker-e2e",
          state: "success",
          children: [
            {
              id: 44,
              pid: 3,
              name: "tempo",
              type: "service",
              state: "failure",
              exit_code: 137,
            },
          ],
        },
        { name: "optional", state: "running" },
      ],
    };
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("ready");
  });
  test("lagging and previous-attempt check publication cannot produce ready", () => {
    const snapshot = ciFixture();
    snapshot.checks[1] = {
      name: "ci/woodpecker/pr/ci-complete",
      state: "fail",
      url: "https://woodpecker.sjer.red/repos/1/pipeline/6/2",
      appId: null,
    };
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("waiting");
    snapshot.checks[1].state = "pass";
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("waiting");
  });
  test("a stale success cannot mask a failed current workflow", () => {
    const snapshot = ciFixture();
    snapshot.pipeline?.workflows.push({
      name: "verify-again",
      state: "failure",
    });
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("failure");
  });
  test("required external checks honor producer identity; optional checks are advisory", () => {
    const snapshot = ciFixture();
    snapshot.checks.push({
      name: "optional-scanner",
      state: "fail",
      url: null,
      appId: null,
    });
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("ready");
    snapshot.rules.checks.push({ name: "security", appId: 42 });
    snapshot.checks.push({
      name: "security",
      state: "pass",
      url: null,
      appId: 43,
    });
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("waiting");
    snapshot.checks.push({
      name: "security",
      state: "fail",
      url: null,
      appId: 42,
    });
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("failure");
  });
});

describe("review and structural readiness", () => {
  test("human changes requests survive later non-decisive comments", () => {
    const snapshot = ciFixture();
    const review = {
      id: 1,
      node_id: "PRR_1",
      user: { login: "alice", type: "User" },
      body: "Please fix this",
      html_url: "https://github.com/example/review/1",
      submitted_at: "2026-10-04T01:00:00Z",
      commit_id: CI_HEAD,
    };
    snapshot.reviews = [
      { ...review, state: "CHANGES_REQUESTED" },
      {
        ...review,
        id: 2,
        state: "COMMENTED",
        submitted_at: "2026-10-04T02:00:00Z",
      },
    ];
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("human_action");
    snapshot.reviews.push({
      ...review,
      id: 3,
      state: "APPROVED",
      submitted_at: "2026-10-04T03:00:00Z",
    });
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("ready");
  });
  test("automated review decisions do not invent a human requirement", () => {
    const snapshot = ciFixture();
    snapshot.reviewDecision = "CHANGES_REQUESTED";
    snapshot.reviews.push({
      id: 1,
      node_id: "PRR_bot",
      user: { login: "coderabbitai[bot]", type: "Bot" },
      body: "finding",
      html_url: "https://github.com/example/review/1",
      state: "CHANGES_REQUESTED",
      submitted_at: "2026-10-04T01:00:00Z",
      commit_id: CI_HEAD,
    });
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("ready");
    snapshot.rules.approvals = 1;
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("human_action");
  });
  test("head movement, main red, conflict, draft, and closed states are distinct", () => {
    const snapshot = ciFixture();
    expect(evaluateReadiness(snapshot, "c".repeat(40)).outcome).toBe(
      "head_changed",
    );
    snapshot.main.state = "red";
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("main_red");
    snapshot.main.state = "green";
    snapshot.pr.mergeable = false;
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("failure");
    snapshot.pr.mergeable = true;
    snapshot.pr.draft = true;
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("human_action");
    snapshot.pr.merged = true;
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("pr_closed");
    expect(EXIT_CODES.main_red).toBe(5);
  });
  test("absence, incomplete merge metadata, and evidence races remain pending", () => {
    const snapshot = ciFixture();
    snapshot.pipeline = null;
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("waiting");
    snapshot.pipeline = ciFixture().pipeline;
    snapshot.pr.mergeable = null;
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("waiting");
    snapshot.pr.mergeable = true;
    snapshot.consistent = false;
    expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("waiting");
  });
  test("unknown states fail loudly", () => {
    expect(() =>
      pipelineState({
        number: 7,
        commit: CI_HEAD,
        status: "new-status",
        workflows: [],
      }),
    ).toThrow("Unknown Woodpecker");
  });
});

test("main stays red during recovery, detects early failure, and clears on success", () => {
  const failed = {
    number: 6,
    commit: CI_HEAD,
    status: "failure",
    workflows: [],
  };
  expect(mainVerdict({ ...failed, number: 7, status: "running" }, failed)).toBe(
    "red",
  );
  expect(
    mainVerdict(
      {
        ...failed,
        number: 7,
        status: "running",
        workflows: [{ name: "verify", state: "failure" }],
      },
      null,
    ),
  ).toBe("red");
  expect(mainVerdict({ ...failed, number: 7, status: "success" }, failed)).toBe(
    "green",
  );
});

test("cancelled main verdicts stay red and unknown workflow contracts fail loudly", () => {
  const cancelled = {
    number: 6,
    commit: CI_HEAD,
    status: "killed",
    workflows: [],
  };
  expect(mainVerdict(null, cancelled)).toBe("red");
  expect(() =>
    mainVerdict(
      {
        ...cancelled,
        status: "running",
        workflows: [{ name: "verify", state: "new-status" }],
      },
      null,
    ),
  ).toThrow("Unknown Woodpecker");
});
