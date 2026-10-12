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

describe("pull request ownership", () => {
  const identity = {
    approver: { login: "shepherdjerred", id: 3_904_778 },
    expectedBotLogin: "justin-principal-engineer[bot]",
  };

  function clientFor(author: unknown): GitHubClient {
    const pr = {
      number: 42,
      url: "https://github.com/owner/repo/pull/42",
      headRefOid: HEAD,
      headRefName: "task/ai-84",
      baseRefName: "main",
      mergeCommit: null,
      isDraft: true,
      mergedAt: null,
      author,
    };
    const run: CommandRunner = async (args) => ({
      exitCode: 0,
      stdout: JSON.stringify(args.includes("list") ? [pr] : pr),
      stderr: "",
      timedOut: false,
    });
    return new GitHubClient("owner/repo", identity, run, {});
  }

  test.each([
    "justin-principal-engineer[bot]",
    "app/justin-principal-engineer",
  ])("accepts the configured bot as %s", async (login) => {
    const client = clientFor({ login, is_bot: true });
    await expect(client.pullRequest(42)).resolves.toMatchObject({ number: 42 });
    await expect(
      client.pullRequestForBranch("task/ai-84"),
    ).resolves.toMatchObject({
      number: 42,
    });
  });

  test.each([
    { login: "app/another-app", is_bot: true },
    { login: "another-app[bot]", is_bot: true },
    { login: "app/justin-principal-engineer", is_bot: false },
    { login: "justin-principal-engineer[bot]", is_bot: false },
  ])("rejects a different or non-bot author: $login", async (author) => {
    const client = clientFor(author);
    await expect(client.pullRequest(42)).rejects.toThrow("Refusing PR #42");
    await expect(client.pullRequestForBranch("task/ai-84")).rejects.toThrow(
      "Refusing PR #42",
    );
  });

  test("requires the producer's bot marker", async () => {
    const client = clientFor({ login: "app/justin-principal-engineer" });
    await expect(client.pullRequest(42)).rejects.toThrow();
    await expect(client.pullRequestForBranch("task/ai-84")).rejects.toThrow();
  });
});

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
    const commands: (readonly string[])[] = [];
    let merged = false;
    const run: CommandRunner = async (args) => {
      commands.push(args);
      if (args[0] === "toolkit") merged = true;
      const pr = {
        number: 42,
        url: "https://github.com/owner/repo/pull/42",
        headRefOid: HEAD,
        headRefName: "task/ai-84",
        baseRefName: "main",
        isDraft: false,
        author: { login: "app/justin-principal-engineer", is_bot: true },
        mergedAt: merged ? "2026-01-01T00:00:00Z" : null,
        mergeCommit: merged ? { oid: "b".repeat(40) } : null,
      };
      return {
        exitCode: 0,
        stdout: args[0] === "gh" ? JSON.stringify(pr) : "",
        stderr: "",
        timedOut: false,
      };
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

    const result = await client.merge(42, HEAD, {
      checkout: "/tmp/task",
      branch: "task/ai-84",
      readyCommand: ["bun", "/trusted/cli.ts", "merge-ready", "AI-84"],
    });
    expect(
      commands.find((args) => args.includes("spice.merge.command"))?.at(-1),
    ).toContain(`sha=${HEAD}`);
    expect(
      commands
        .find((args) => args.includes("spice.merge.ready.command"))
        ?.at(-1),
    ).toContain("'/trusted/cli.ts'");
    expect(
      commands.some(
        (args) =>
          args.slice(0, 4).join(" ") === "toolkit git-spice branch merge",
      ),
    ).toBe(true);
    expect(result.mergeCommit?.oid).toBe("b".repeat(40));
  });
});
