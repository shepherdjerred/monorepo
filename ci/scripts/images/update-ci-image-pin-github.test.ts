import { beforeEach, expect, test, vi } from "vitest";
import type { run } from "../../../scripts/lib/run.ts";
import { ciImageDefinition } from "./build-ci-image-core.ts";
import {
  deferReadyPromotion,
  openOrUpdatePullRequest,
  retireStalePromotion,
} from "./update-ci-image-pin-github.ts";

const { execute } = vi.hoisted(() => ({ execute: vi.fn<typeof run>() }));
vi.mock("../../../scripts/lib/run.ts", () => ({ run: execute }));
const sha = "a".repeat(40);
const readyPr = { number: 12, isDraft: false, headRefOid: sha };
const options = {
  cloneDir: "/tmp/isolated-pin-fixture",
  definition: ciImageDefinition("ci-base"),
  env: {},
  expectedRemoteSha: sha,
  state: {
    schema: "ci-image-pin-state/v1" as const,
    image: "ci-base" as const,
    buildNumber: 12,
    sourceCommit: sha,
    sourceFingerprint: "a".repeat(64),
    digest: `sha256:${"b".repeat(64)}`,
  },
};
beforeEach(() => execute.mockReset());
function readyPromotion(autoMerge: boolean): void {
  execute.mockImplementation((command = []) =>
    Promise.resolve({
      exitCode: 0,
      stderr: "",
      stdout: command.includes("list")
        ? JSON.stringify([{ number: 12, isDraft: false, headRefOid: sha }])
        : command.includes("view")
          ? String(autoMerge)
          : "",
    }),
  );
}
test("ready promotion PRs with auto-merge are neither pushed nor retired", async () => {
  readyPromotion(true);
  await openOrUpdatePullRequest(options);
  await retireStalePromotion(options);
  const commands = execute.mock.calls.map((call) => call[0]);
  expect(commands).toHaveLength(4);
  for (const command of commands) {
    expect(command.includes("list") || command.includes("view")).toBe(true);
  }
});
test("a ready promotion missing auto-merge gets it before deferring", async () => {
  readyPromotion(false);
  expect(await deferReadyPromotion(readyPr, {})).toBe(true);
  const commands = execute.mock.calls.map((call) => call[0]);
  expect(commands.at(-1)).toEqual([
    "gh",
    "pr",
    "merge",
    "--repo",
    "shepherdjerred/monorepo",
    "12",
    "--auto",
    "--squash",
  ]);
  expect(commands.some((command) => command.includes("push"))).toBe(false);
});
test("draft promotions are not deferred", async () => {
  expect(await deferReadyPromotion({ ...readyPr, isDraft: true }, {})).toBe(
    false,
  );
  expect(await deferReadyPromotion(undefined, {})).toBe(false);
  expect(execute).not.toHaveBeenCalled();
});
test("a moved draft head rejects a stale update before push", async () => {
  execute.mockResolvedValue({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify([
      { number: 12, isDraft: true, headRefOid: "b".repeat(40) },
    ]),
  });
  await expect(openOrUpdatePullRequest(options)).rejects.toThrow(
    "ready or changed",
  );
  expect(execute).toHaveBeenCalledTimes(1);
});
test("new promotion PRs are ready with squash auto-merge", async () => {
  const outputs = ["[]", "", "", "", "12", ""];
  execute.mockImplementation(() =>
    Promise.resolve({
      exitCode: 0,
      stderr: "",
      stdout: outputs.shift() ?? "unexpected",
    }),
  );
  await openOrUpdatePullRequest(options);
  const commands = execute.mock.calls.map((call) => call[0]);
  expect(commands.find((command) => command.includes("create"))).not.toContain(
    "--draft",
  );
  expect(commands.at(-1)).toEqual([
    "gh",
    "pr",
    "merge",
    "--repo",
    "shepherdjerred/monorepo",
    "12",
    "--auto",
    "--squash",
  ]);
  expect(commands.find((command) => command.includes("push"))).toContain(
    `--force-with-lease=refs/heads/${options.definition.branch}:${sha}`,
  );
});
