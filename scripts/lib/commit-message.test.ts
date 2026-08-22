import { expect, test } from "vitest";
import { validateCommitMessage } from "./commit-message.ts";

const repositoryRoot = new URL("../..", import.meta.url).pathname;

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
