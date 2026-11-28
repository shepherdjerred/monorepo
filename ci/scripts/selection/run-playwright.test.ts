import { expect, test } from "vitest";
import { allPlaywrightTargets } from "./playwright-targets.ts";
import {
  parsePlaywrightPartition,
  partitionPlaywrightSelection,
} from "./playwright-partition.ts";
import { resolvePlaywrightBase } from "./run-playwright.ts";

const commit = "a".repeat(40);

test("defaults to the full runner and refuses invalid partition flags", () => {
  expect(parsePlaywrightPartition([])).toBe("all");
  expect(parsePlaywrightPartition(["--partition", "primary"])).toBe("primary");
  expect(parsePlaywrightPartition(["--partition", "media"])).toBe("media");
  for (const args of [
    ["--partition"],
    ["--partition", "typo"],
    ["--partition", "primary", "media"],
    ["primary"],
  ]) {
    expect(() => parsePlaywrightPartition(args)).toThrow(
      "Usage: run-playwright.ts [--partition primary|media]",
    );
  }
});

test("partitions the entire fail-open selection once and preserves its rationale", () => {
  const selection = allPlaywrightTargets("changed-file base unavailable");
  const primary = partitionPlaywrightSelection(selection, "primary");
  const media = partitionPlaywrightSelection(selection, "media");

  expect(partitionPlaywrightSelection(selection, "all")).toBe(selection);
  expect(media.targets.map((target) => target.package)).toEqual([
    "@shepherdjerred/media",
  ]);
  const full = selection.targets.map((target) => target.package).sort();
  const split = [...primary.targets, ...media.targets]
    .map((target) => target.package)
    .sort();
  expect(split).toEqual(full);
  for (const lane of [primary, media]) {
    expect(lane.mode).toBe("all");
    expect(lane.globalReason).toBe(selection.globalReason);
    expect(lane.reasons).toEqual(
      Object.fromEntries(
        lane.targets.map((target) => [
          target.package,
          selection.reasons[target.package],
        ]),
      ),
    );
  }
});

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
