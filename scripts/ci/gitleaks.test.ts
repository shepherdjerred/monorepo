import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { describe, expect, test } from "vitest";
import { createTrackedSnapshot, gitleaksCommand } from "./gitleaks.ts";

function git(repository: string, ...args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: repository,
    stdio: "ignore",
  });
  expect(result.status).toBe(0);
}

describe("gitleaks CI scope", () => {
  test("full scan snapshot contains committed content only", async () => {
    const repository = await mkdtemp(nodePath.join(tmpdir(), "gitleaks-test-"));
    let snapshot: string | undefined;
    try {
      git(repository, "init", "-q");
      await writeFile(nodePath.join(repository, "tracked.txt"), "committed\n");
      git(repository, "add", "tracked.txt");
      git(
        repository,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-qm",
        "test",
      );
      await writeFile(nodePath.join(repository, "tracked.txt"), "modified\n");
      await writeFile(
        nodePath.join(repository, "generated.txt"),
        "generated\n",
      );

      snapshot = await createTrackedSnapshot(repository);
      expect(await readdir(snapshot)).toEqual(["tracked.txt"]);
      expect(
        await readFile(nodePath.join(snapshot, "tracked.txt"), "utf8"),
      ).toBe("committed\n");
    } finally {
      if (snapshot !== undefined) {
        await rm(snapshot, { recursive: true, force: true });
      }
      await rm(repository, { recursive: true, force: true });
    }
  });

  test("scans only commits since the validated green base", async () => {
    expect(
      await gitleaksCommand(
        { CI_CHANGED_BASE: "abc123" },
        () => Promise.resolve(0),
        () => Promise.resolve(["packages/example.ts"]),
      ),
    ).toEqual([
      "gitleaks",
      "git",
      "--log-opts=abc123..HEAD",
      "--redact",
      "--verbose",
      "--no-banner",
      ".",
    ]);
  });

  test("fails open to a complete tree scan", async () => {
    expect(await gitleaksCommand({})).toEqual([
      "gitleaks",
      "detect",
      "--source",
      ".",
      "--no-git",
      "--redact",
      "--verbose",
      "--no-banner",
    ]);
    expect(
      await gitleaksCommand({ CI_CHANGED_BASE: "missing" }, () =>
        Promise.resolve(1),
      ),
    ).toEqual([
      "gitleaks",
      "detect",
      "--source",
      ".",
      "--no-git",
      "--redact",
      "--verbose",
      "--no-banner",
    ]);
  });

  test.each([".gitleaks.toml", ".mise.toml"])(
    "scans the complete tree when %s changes",
    async (path) => {
      expect(
        await gitleaksCommand(
          { CI_CHANGED_BASE: "abc123" },
          () => Promise.resolve(0),
          () => Promise.resolve([path]),
        ),
      ).toEqual([
        "gitleaks",
        "detect",
        "--source",
        ".",
        "--no-git",
        "--redact",
        "--verbose",
        "--no-banner",
      ]);
    },
  );
});
