import { expect, test } from "vitest";
import { resolvePlaywrightBase } from "./run-playwright.ts";

const commit = "a".repeat(40);

test.each(["origin/main", "aaaaaaa", commit])(
  "records the full commit for base %s",
  async (base) => {
    const observed: string[][] = [];
    const result = await resolvePlaywrightBase(
      base,
      async (command) => {
        observed.push([...command]);
        return {
          exitCode: 0,
          stdout: command[1] === "rev-parse" ? `${commit}\n` : "",
        };
      },
      "pull_request",
    );
    expect(result).toBe(commit);
    expect(observed).toContainEqual([
      "git",
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${base}^{commit}`,
    ]);
    expect(observed).toContainEqual([
      "git",
      "merge-base",
      "--is-ancestor",
      commit,
      "HEAD",
    ]);
  },
);

test("rejects an unavailable base and a ref that moves outside the head ancestry", async () => {
  expect(
    await resolvePlaywrightBase(
      "missing",
      async () => ({ exitCode: 1, stdout: "" }),
      "pull_request",
    ),
  ).toBeNull();
  expect(
    await resolvePlaywrightBase(
      "moving-ref",
      async (command) => ({
        exitCode: command[1] === "merge-base" && command[3] === commit ? 1 : 0,
        stdout: command[1] === "rev-parse" ? commit : "",
      }),
      "pull_request",
    ),
  ).toBeNull();
});
