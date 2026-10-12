import { describe, expect, test } from "vitest";
import {
  hasExactHeadApproval,
  pullRequestNumber,
} from "#src/github-approval.ts";
import { PipelineSchema } from "#src/schemas.ts";

const COMMIT = "a".repeat(40);

function pipeline(overrides: Record<string, unknown> = {}) {
  return PipelineSchema.parse({
    event: "pull_request",
    branch: "main",
    commit: COMMIT,
    ref: "refs/pull/42/head",
    forge_url: "https://github.com/shepherdjerred/monorepo/pull/42",
    changed_files: ["bun.lock"],
    author: "renovate[bot]",
    sender: "renovate[bot]",
    ...overrides,
  });
}

function reviews(body: unknown) {
  return hasExactHeadApproval(pipeline(), {
    repo: "shepherdjerred/monorepo",
    reviewer: "shepherdjerred",
    token: "read-only",
    fetchImpl: async () => Response.json(body),
  });
}

describe("hosted automation approval", () => {
  test("parses only a pull-request head ref", () => {
    expect(pullRequestNumber(pipeline())).toBe(42);
    expect(() =>
      pullRequestNumber(pipeline({ ref: "refs/heads/main" })),
    ).toThrow("no pull request ref");
  });

  test("accepts the owner's approval for the exact head", async () => {
    await expect(
      reviews([
        {
          id: 1,
          commit_id: COMMIT,
          state: "APPROVED",
          submitted_at: "2026-10-04T10:00:00Z",
          user: { login: "shepherdjerred" },
        },
      ]),
    ).resolves.toBe(true);
  });

  test("ignores pending reviews without a submission time", async () => {
    await expect(
      reviews([
        {
          id: 1,
          commit_id: COMMIT,
          state: "APPROVED",
          submitted_at: "2026-10-04T10:00:00Z",
          user: { login: "shepherdjerred" },
        },
        {
          id: 2,
          commit_id: COMMIT,
          state: "PENDING",
          user: { login: "shepherdjerred" },
        },
      ]),
    ).resolves.toBe(true);
  });

  test("ignores non-decision reviews after an approval", async () => {
    await expect(
      reviews([
        {
          id: 1,
          commit_id: COMMIT,
          state: "APPROVED",
          submitted_at: "2026-10-04T10:00:00Z",
          user: { login: "shepherdjerred" },
        },
        {
          id: 2,
          commit_id: COMMIT,
          state: "COMMENTED",
          submitted_at: "2026-10-04T11:00:00Z",
          user: { login: "shepherdjerred" },
        },
      ]),
    ).resolves.toBe(true);
  });

  test("rejects stale, foreign, dismissed, and changes-requested reviews", async () => {
    for (const body of [
      [
        {
          id: 1,
          commit_id: "b".repeat(40),
          state: "APPROVED",
          submitted_at: "2026-10-04T10:00:00Z",
          user: { login: "shepherdjerred" },
        },
      ],
      [
        {
          id: 1,
          commit_id: COMMIT,
          state: "APPROVED",
          submitted_at: "2026-10-04T10:00:00Z",
          user: { login: "other" },
        },
      ],
      [
        {
          id: 1,
          commit_id: COMMIT,
          state: "APPROVED",
          submitted_at: "2026-10-04T10:00:00Z",
          user: { login: "shepherdjerred" },
        },
        {
          id: 2,
          commit_id: COMMIT,
          state: "DISMISSED",
          submitted_at: "2026-10-04T11:00:00Z",
          user: { login: "shepherdjerred" },
        },
      ],
      [
        {
          id: 1,
          commit_id: COMMIT,
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-10-04T10:00:00Z",
          user: { login: "shepherdjerred" },
        },
      ],
    ]) {
      await expect(reviews(body)).resolves.toBe(false);
    }
  });

  test("fails loudly when GitHub cannot establish review state", async () => {
    await expect(
      hasExactHeadApproval(pipeline(), {
        repo: "shepherdjerred/monorepo",
        reviewer: "shepherdjerred",
        token: "read-only",
        fetchImpl: async () => new Response("", { status: 503 }),
      }),
    ).rejects.toThrow("review lookup failed (503)");
  });

  test("bounds the GitHub review request", async () => {
    let signal: AbortSignal | null | undefined;
    await hasExactHeadApproval(pipeline(), {
      repo: "shepherdjerred/monorepo",
      reviewer: "shepherdjerred",
      token: "read-only",
      fetchImpl: async (_input, init) => {
        signal = init?.signal;
        return Response.json([]);
      },
    });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });
});
