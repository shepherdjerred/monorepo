import { expect, test } from "bun:test";
import {
  formatStatus,
  isSafeWorktree,
  parseCleanupArguments,
  parsePullRequest,
  parseWorktrees,
  pullRequestAgeInDays,
  readConfirmationLine,
} from "../bin/git_cleanup_core.ts";

function openInput(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    },
  });
}

test("defaults to report-only mode", () => {
  expect(parseCleanupArguments([], "/home")).toEqual({
    directory: "/home/git",
    apply: false,
    yes: false,
    checkPullRequests: true,
    includeClosedPullRequests: false,
    removeCleanWorktrees: false,
    stalePullRequestDays: 21,
    summary: false,
    verbose: false,
    color: true,
  });
});

test("parses every supported option", () => {
  expect(
    parseCleanupArguments(
      [
        "/repos",
        "--apply",
        "--yes",
        "--no-prs",
        "--include-closed-prs",
        "--remove-clean-worktrees",
        "--stale-pr-days",
        "7",
        "--summary",
        "--verbose",
        "--no-color",
      ],
      "/home",
    ),
  ).toEqual({
    directory: "/repos",
    apply: true,
    yes: true,
    checkPullRequests: false,
    includeClosedPullRequests: true,
    removeCleanWorktrees: true,
    stalePullRequestDays: 7,
    summary: true,
    verbose: true,
    color: false,
  });
});

test("rejects invalid argument combinations", () => {
  expect(() => parseCleanupArguments(["--yes"], "/home")).toThrow("--apply");
  expect(() =>
    parseCleanupArguments(["--stale-pr-days", "0"], "/home"),
  ).toThrow("positive integer");
  expect(() => parseCleanupArguments(["--stale-pr-days"], "/home")).toThrow(
    "positive integer",
  );
  expect(() => parseCleanupArguments(["--unknown"], "/home")).toThrow(
    "Unknown option",
  );
  expect(() => parseCleanupArguments(["--help"], "/home")).toThrow("help");
});

test("dirty or unpushed worktrees are never safe", () => {
  expect(isSafeWorktree(" M file", 0)).toBe(false);
  expect(isSafeWorktree("", 1)).toBe(false);
  expect(isSafeWorktree("", 0)).toBe(true);
});

test("parses porcelain worktrees without relying on spaces", () => {
  expect(
    parseWorktrees(
      "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/wt\nHEAD def\nbranch refs/heads/feature\n",
    ),
  ).toEqual([
    { path: "/repo", branch: "main" },
    { path: "/repo/wt", branch: "feature" },
  ]);
  expect(
    parseWorktrees("worktree /repo/detached\nHEAD abc\ndetached\n"),
  ).toEqual([{ path: "/repo/detached" }]);
  expect(() => parseWorktrees("HEAD abc")).toThrow("Malformed");
});

test("validates pull request responses", () => {
  expect(parsePullRequest("[]")).toEqual({ state: "NONE" });
  expect(parsePullRequest("{}")).toEqual({ state: "NONE" });
  const updatedAt = "2026-07-01T00:00:00.000Z";
  expect(
    parsePullRequest(JSON.stringify([{ state: "OPEN", updatedAt }])),
  ).toEqual({ state: "OPEN", updatedAt: new Date(updatedAt) });
  expect(() => parsePullRequest('[{"updatedAt":"2026-07-01"}]')).toThrow(
    "Malformed",
  );
  expect(() =>
    parsePullRequest('[{"state":"DRAFT","updatedAt":"2026-07-01"}]'),
  ).toThrow("Unexpected");
  expect(() => parsePullRequest('[{"state":"MERGED"}]')).toThrow("lacks");
  expect(() =>
    parsePullRequest('[{"state":"CLOSED","updatedAt":"invalid"}]'),
  ).toThrow("invalid");
});

test("calculates PR age and formats status output", () => {
  expect(
    pullRequestAgeInDays(
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-08T12:00:00.000Z"),
    ),
  ).toBe(7);
  expect(formatStatus("KEEP", "branch", false)).toBe("KEEP branch");
  expect(formatStatus("REMOVE", "branch", true)).toContain("\u001B[32m");
  expect(formatStatus("WOULD REMOVE", "branch", true)).toContain("\u001B[36m");
  expect(formatStatus("STALE", "branch", true)).toContain("\u001B[33m");
});

test("interactive confirmation resolves on the first newline without EOF", async () => {
  await expect(
    readConfirmationLine(openInput("AP", "PLY\nignored")),
  ).resolves.toBe("APPLY");
});
