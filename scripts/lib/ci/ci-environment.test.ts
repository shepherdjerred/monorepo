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

test("reads the CI environment", () => {
  expect(commitSha(WOODPECKER)).toBe("wood-sha");
  expect(branch(WOODPECKER)).toBe("feature");
  expect(buildNumber(WOODPECKER)).toBe(4218);
  expect(isCi(WOODPECKER)).toBe(true);
});

/**
 * The migration read Buildkite's names as a fallback so scripts could be
 * switched over while Buildkite was still the live gate. Those are gone: a
 * leftover variable must not be able to satisfy a required one.
 */
test("does not accept a Buildkite variable in place of its successor", () => {
  expect(() => commitSha({ BUILDKITE_COMMIT: "bk-sha" })).toThrow(
    /CI_COMMIT_SHA/u,
  );
  expect(isCi({ BUILDKITE: "true" })).toBe(false);
});

test("treats an empty value as absent", () => {
  expect(() => commitSha({ CI_COMMIT_SHA: "" })).toThrow(/CI_COMMIT_SHA/u);
});

test("defaults the default branch rather than failing", () => {
  expect(defaultBranch({})).toBe("main");
});

test("fails loudly when a required variable is absent", () => {
  expect(() => commitSha({})).toThrow(/CI_COMMIT_SHA/u);
});

test("rejects a non-numeric build number", () => {
  expect(() => buildNumber({ CI_PIPELINE_NUMBER: "abc" })).toThrow(
    /not a positive integer/u,
  );
});

/**
 * A non-PR build reports a value rather than omitting the variable, so
 * anything that is not a positive integer means "not a pull request".
 */
test("reports no pull request for a branch build", () => {
  expect(pullRequestNumber({ CI_COMMIT_PULL_REQUEST: "" })).toBeUndefined();
  expect(pullRequestNumber({ CI_COMMIT_PULL_REQUEST: "0" })).toBeUndefined();
  expect(pullRequestNumber({})).toBeUndefined();
});

test("reads a pull request number and base branch", () => {
  expect(pullRequestNumber({ CI_COMMIT_PULL_REQUEST: "42" })).toBe(42);
  expect(pullRequestBaseBranch({ CI_COMMIT_TARGET_BRANCH: "main" })).toBe(
    "main",
  );
});

test("is not CI outside a build", () => {
  expect(isCi({})).toBe(false);
});
