import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { validateCommitMessage } from "./commit-message.ts";

let repositoryRoot = "";

beforeAll(async () => {
  repositoryRoot = await mkdtemp(path.join(tmpdir(), "script-kit-commit-"));
  await mkdir(path.join(repositoryRoot, "packages/pr-fleet-controller"), {
    recursive: true,
  });
});

afterAll(async () => {
  await rm(repositoryRoot, { recursive: true, force: true });
});

test("accepts a commit scope backed by a workspace package", async () => {
  await expect(
    validateCommitMessage(
      "feat(pr-fleet-controller): record worker progress",
      repositoryRoot,
    ),
  ).resolves.toEqual({ valid: true });
});

test("rejects an unknown commit scope", async () => {
  await expect(
    validateCommitMessage(
      "feat(unknown): record worker progress",
      repositoryRoot,
    ),
  ).resolves.toMatchObject({
    valid: false,
    error: expect.stringContaining('Invalid commit scope: "unknown"'),
  });
});
