import { expect, test } from "vitest";
import {
  branch,
  buildNumber,
  commitSha,
  defaultBranch,
  isCi,
  pullRequestBaseBranch,
  pullRequestNumber,
} from "./ci-environment.ts";

const WOODPECKER = {
  CI: "true",
  CI_COMMIT_SHA: "wood-sha",
  CI_COMMIT_BRANCH: "feature",
  CI_PIPELINE_NUMBER: "4218",
  CI_REPO_DEFAULT_BRANCH: "main",
};

const BUILDKITE = {
  BUILDKITE: "true",
  BUILDKITE_COMMIT: "bk-sha",
  BUILDKITE_BRANCH: "feature",
  BUILDKITE_BUILD_NUMBER: "9000",
  BUILDKITE_PIPELINE_DEFAULT_BRANCH: "main",
};

test("reads the Woodpecker environment", () => {
  expect(commitSha(WOODPECKER)).toBe("wood-sha");
  expect(buildNumber(WOODPECKER)).toBe(4218);
  expect(isCi(WOODPECKER)).toBe(true);
});

/** Buildkite must keep working until the cutover. */
test("falls back to the Buildkite environment", () => {
  expect(commitSha(BUILDKITE)).toBe("bk-sha");
  expect(branch(BUILDKITE)).toBe("feature");
  expect(buildNumber(BUILDKITE)).toBe(9000);
  expect(isCi(BUILDKITE)).toBe(true);
});

test("prefers Woodpecker when a step sets both", () => {
  expect(commitSha({ ...BUILDKITE, ...WOODPECKER })).toBe("wood-sha");
});

test("treats an empty value as absent", () => {
  expect(commitSha({ CI_COMMIT_SHA: "", BUILDKITE_COMMIT: "bk-sha" })).toBe(
    "bk-sha",
  );
});

test("defaults the default branch rather than failing", () => {
  expect(defaultBranch({})).toBe("main");
});

test("fails loudly when a required variable is absent", () => {
  expect(() => commitSha({})).toThrow(/CI_COMMIT_SHA \(or BUILDKITE_COMMIT\)/u);
});

test("rejects a non-numeric build number", () => {
  expect(() => buildNumber({ CI_PIPELINE_NUMBER: "abc" })).toThrow(
    /not a positive integer/u,
  );
});

/**
 * Both providers report a non-PR build with a value rather than by omitting
 * the variable; Buildkite uses the literal string "false".
 */
test("reports no pull request for a branch build", () => {
  expect(
    pullRequestNumber({ BUILDKITE_PULL_REQUEST: "false" }),
  ).toBeUndefined();
  expect(pullRequestNumber({ CI_COMMIT_PULL_REQUEST: "" })).toBeUndefined();
  expect(pullRequestNumber({})).toBeUndefined();
});

test("reads a pull request number from either provider", () => {
  expect(pullRequestNumber({ CI_COMMIT_PULL_REQUEST: "42" })).toBe(42);
  expect(pullRequestNumber({ BUILDKITE_PULL_REQUEST: "42" })).toBe(42);
  expect(
    pullRequestBaseBranch({ BUILDKITE_PULL_REQUEST_BASE_BRANCH: "main" }),
  ).toBe("main");
});

test("is not CI outside a build", () => {
  expect(isCi({})).toBe(false);
});
