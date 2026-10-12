import { expect, test, vi } from "vitest";
import { z } from "zod";
import { publishReleaseRefinement } from "./publish-release-refinement.ts";

const original = "a".repeat(40);
const refined = "b".repeat(40);
const input = {
  clone: "/tmp/refiner-fixture",
  body: "/tmp/body.md",
  expectedHead: original,
  env: {},
};
const pr = (isDraft: boolean, head = original) =>
  JSON.stringify([{ number: 42, isDraft, headRefOid: head }]);
test("ready release PRs get no writes", async () => {
  const execute = vi
    .fn()
    .mockResolvedValue({ stdout: pr(false), stderr: "", exitCode: 0 });
  expect(await publishReleaseRefinement(input, execute)).toBe("deferred");
  expect(execute).toHaveBeenCalledTimes(1);
});
test.each([false, true])(
  "checks the draft again before body publication (ready=%s)",
  async (ready) => {
    const responses = [pr(true), refined, "", pr(!ready, refined), ""];
    const execute = vi.fn().mockImplementation(() =>
      Promise.resolve({
        stdout: responses.shift() ?? "unexpected",
        stderr: "",
        exitCode: 0,
      }),
    );
    expect(await publishReleaseRefinement(input, execute)).toBe(
      ready ? "deferred" : "published",
    );
    const commands = execute.mock.calls.map((call) =>
      z.array(z.string()).parse(call[0]),
    );
    expect(commands.find((command) => command.includes("push"))).toContain(
      `--force-with-lease=refs/heads/release-please--branches--main:${original}`,
    );
    expect(commands.some((command) => command.includes("edit"))).toBe(!ready);
  },
);
test("a moved draft fails before writing", async () => {
  const execute = vi
    .fn()
    .mockResolvedValue({ stdout: pr(true, refined), stderr: "", exitCode: 0 });
  await expect(publishReleaseRefinement(input, execute)).rejects.toThrow(
    "ready or changed",
  );
  expect(execute).toHaveBeenCalledTimes(1);
});
