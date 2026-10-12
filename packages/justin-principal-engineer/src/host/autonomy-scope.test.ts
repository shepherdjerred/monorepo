import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { assertAutonomousScope } from "#src/host/autonomy-scope.ts";
import { runCommand, requireSuccess } from "#src/runtime/process.ts";

async function repository() {
  const checkout = await mkdtemp(path.join(os.tmpdir(), "justin-scope-"));
  const git = async (...args: string[]) =>
    requireSuccess(
      "Fixture git",
      await runCommand(["git", ...args], { cwd: checkout }),
    );
  await git("init", "-b", "main");
  await git("config", "user.name", "Fixture");
  await git("config", "user.email", "fixture@example.com");
  await Bun.write(
    path.join(checkout, "package.json"),
    JSON.stringify({
      workspaces: [
        "packages/toolkit",
        "packages/other",
        "packages/docs/wiki",
        "packages/code-review",
      ],
    }),
  );
  await Bun.write(
    path.join(checkout, "packages/toolkit/src/cli.ts"),
    "export const value = 1;\n",
  );
  await Bun.write(
    path.join(checkout, "packages/toolkit/package.json"),
    JSON.stringify({
      name: "@fixture/toolkit",
      dependencies: { example: "1.0.0", other: "2.0.0" },
      scripts: { test: "vitest run test/lib" },
    }),
  );
  await git("add", "package.json", "packages/toolkit");
  await git("commit", "-m", "fixture");
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  const check = (paths: string[]) =>
    assertAutonomousScope({
      checkout,
      paths,
      baseBranch: "main",
      run: runCommand,
    });
  return {
    checkout,
    git,
    check,
    cleanup: () => rm(checkout, { recursive: true }),
  };
}

describe("autonomous branch scope", () => {
  test("allows registering regression tests and manifest metadata through the complete branch", async () => {
    const repo = await repository();
    try {
      await Bun.write(
        path.join(repo.checkout, "packages/toolkit/package.json"),
        JSON.stringify({
          name: "@fixture/toolkit",
          description: "CLI tools",
          dependencies: { other: "2.0.0", example: "1.0.0" },
          scripts: { test: "vitest run test/cli test/lib" },
        }),
      );
      await repo.git("add", "packages/toolkit/package.json");
      await repo.git("commit", "-m", "register CLI coverage");
      await expect(
        repo.check(["packages/toolkit/package.json"]),
      ).resolves.toBeUndefined();
    } finally {
      await repo.cleanup();
    }
  });

  test.each([
    { example: "1.0.0", other: "2.0.0", added: "3.0.0" },
    { example: "2.0.0", other: "2.0.0" },
    { example: "1.0.0" },
  ])("rejects actual dependency changes: %j", async (dependencies) => {
    const repo = await repository();
    try {
      await Bun.write(
        path.join(repo.checkout, "packages/toolkit/package.json"),
        JSON.stringify({
          name: "@fixture/toolkit",
          dependencies,
          scripts: { test: "vitest run test/lib" },
        }),
      );
      await expect(
        repo.check(["packages/toolkit/package.json"]),
      ).rejects.toThrow("dependency changes");
    } finally {
      await repo.cleanup();
    }
  });

  test("allows one existing workspace and related wiki documentation", async () => {
    const repo = await repository();
    try {
      await Bun.write(
        path.join(repo.checkout, "packages/toolkit/src/cli.ts"),
        "export const value = 2;\n",
      );
      await Bun.write(
        path.join(
          repo.checkout,
          "packages/docs/wiki/src/content/docs/how-to/cli.md",
        ),
        "CLI usage\n",
      );
      await expect(
        repo.check([
          "packages/toolkit/src/cli.ts",
          "packages/docs/wiki/src/content/docs/how-to/cli.md",
        ]),
      ).resolves.toBeUndefined();
    } finally {
      await repo.cleanup();
    }
  });

  test.each([
    "packages/toolkit/AGENTS.md",
    "packages/code-review/src/gate.ts",
    "packages/toolkit/src/lib/github/client.ts",
    "packages/new/src/index.ts",
    ".github/workflows/ci.yml",
  ])("rejects protected or new workspace paths: %s", async (file) => {
    const repo = await repository();
    try {
      await expect(repo.check([file])).rejects.toThrow("Autonomous scope");
    } finally {
      await repo.cleanup();
    }
  });

  test("checks earlier committed changes as well as the current turn", async () => {
    const repo = await repository();
    try {
      await Bun.write(
        path.join(repo.checkout, "packages/toolkit/src/cli.ts"),
        'export const header = "Authorization";\n',
      );
      await repo.git("add", "packages/toolkit/src/cli.ts");
      await repo.git("commit", "-m", "earlier turn");
      await expect(repo.check(["packages/toolkit/src/cli.ts"])).rejects.toThrow(
        "credential and authentication",
      );
    } finally {
      await repo.cleanup();
    }
  });

  test("rejects untracked credential edits, symlinks, and changes to two workspaces", async () => {
    const repo = await repository();
    try {
      const directory = path.join(repo.checkout, "packages/toolkit/src");
      await Bun.write(
        path.join(directory, "new.ts"),
        "export const authToken = undefined;\n",
      );
      await expect(repo.check(["packages/toolkit/src/new.ts"])).rejects.toThrow(
        "credential and authentication",
      );
      await mkdir(path.join(repo.checkout, "packages/other/src"), {
        recursive: true,
      });
      await symlink(
        path.join(directory, "cli.ts"),
        path.join(directory, "link.ts"),
      );
      await expect(
        repo.check(["packages/toolkit/src/link.ts"]),
      ).rejects.toThrow("symbolic links");
      await expect(
        repo.check([
          "packages/toolkit/src/cli.ts",
          "packages/other/src/index.ts",
        ]),
      ).rejects.toThrow("one existing workspace");
    } finally {
      await repo.cleanup();
    }
  });
});
