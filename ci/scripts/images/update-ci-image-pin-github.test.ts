import { beforeEach, expect, test, vi } from "vitest";
import type { run } from "../../../scripts/lib/run.ts";
import { ciImageDefinition } from "./build-ci-image-core.ts";
import {
  openOrUpdatePullRequest,
  retireStalePromotion,
} from "./update-ci-image-pin-github.ts";

const { execute } = vi.hoisted(() => ({ execute: vi.fn<typeof run>() }));
vi.mock("../../../scripts/lib/run.ts", () => ({ run: execute }));
const sha = "a".repeat(40);
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
test("ready promotion PRs are neither pushed nor retired", async () => {
  execute.mockResolvedValue({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify([{ number: 12, isDraft: false, headRefOid: sha }]),
  });
  await openOrUpdatePullRequest(options);
  await retireStalePromotion(options);
  expect(execute.mock.calls).toHaveLength(2);
  for (const call of execute.mock.calls) expect(call[0]).toContain("list");
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
test("new promotion PRs are drafts without auto-merge", async () => {
  const outputs = ["[]", "", "", "", "12"];
  execute.mockImplementation(() =>
    Promise.resolve({
      exitCode: 0,
      stderr: "",
      stdout: outputs.shift() ?? "unexpected",
    }),
  );
  await openOrUpdatePullRequest(options);
  const commands = execute.mock.calls.map((call) => call[0]);
  expect(commands.find((command) => command.includes("create"))).toContain(
    "--draft",
  );
  expect(commands.some((command) => command.includes("--auto"))).toBe(false);
  expect(commands.find((command) => command.includes("push"))).toContain(
    `--force-with-lease=refs/heads/${options.definition.branch}:${sha}`,
  );
});
