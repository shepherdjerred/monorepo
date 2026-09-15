import { describe, expect, test } from "vitest";

import { GitHubClient } from "#src/integrations/github.ts";
import type { CommandRunner } from "#src/runtime/process.ts";

const HEAD = "a".repeat(40);

function runner(response: unknown): CommandRunner {
  return async () => ({
    exitCode: 0,
    stdout: JSON.stringify([[response].flat()]),
    stderr: "",
    timedOut: false,
  });
}

function review(input: {
  id: number;
  state: string;
  commitId: string;
  submittedAt: string;
}) {
  return {
    id: input.id,
    body: null,
    state: input.state,
    submitted_at: input.submittedAt,
    html_url: null,
    commit_id: input.commitId,
    user: { id: 3_904_778, login: "shepherdjerred" },
  };
}

describe("exact-head approval", () => {
  test("ignores a later comment-only review", async () => {
    const client = new GitHubClient(
      "owner/repo",
      {
        approver: { login: "shepherdjerred", id: 3_904_778 },
        expectedBotLogin: "justin-principal-engineer[bot]",
      },
      runner([
        review({
          id: 1,
          state: "APPROVED",
          commitId: HEAD,
          submittedAt: "2026-01-01T00:00:00Z",
        }),
        review({
          id: 2,
          state: "COMMENTED",
          commitId: HEAD,
          submittedAt: "2026-01-02T00:00:00Z",
        }),
      ]),
      {},
    );
    await expect(client.hasExactHeadApproval(1, HEAD)).resolves.toBe(true);
  });

  test("rejects stale approval and later requested changes", async () => {
    const client = new GitHubClient(
      "owner/repo",
      {
        approver: { login: "shepherdjerred", id: 3_904_778 },
        expectedBotLogin: "justin-principal-engineer[bot]",
      },
      runner([
        review({
          id: 1,
          state: "APPROVED",
          commitId: "b".repeat(40),
          submittedAt: "2026-01-01T00:00:00Z",
        }),
        review({
          id: 2,
          state: "CHANGES_REQUESTED",
          commitId: HEAD,
          submittedAt: "2026-01-02T00:00:00Z",
        }),
      ]),
      {},
    );
    await expect(client.hasExactHeadApproval(1, HEAD)).resolves.toBe(false);
  });
});

describe("merge", () => {
  test("binds the merge mutation to the observed head", async () => {
    let command: readonly string[] = [];
    const run: CommandRunner = async (args) => {
      command = args;
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    };
    const client = new GitHubClient(
      "owner/repo",
      {
        approver: { login: "shepherdjerred", id: 3_904_778 },
        expectedBotLogin: "justin-principal-engineer[bot]",
      },
      run,
      {},
    );

    await client.merge(42, HEAD);

    expect(command).toContain("--match-head-commit");
    expect(command).toContain(HEAD);
  });
});
