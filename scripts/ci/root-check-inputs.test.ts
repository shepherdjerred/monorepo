import { describe, expect, test } from "vitest";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertRootCheckInputs,
  rootCheckEnvironment,
  rootCheckInputsHash,
} from "./root-check-inputs.ts";

describe("root check input contract", () => {
  test("checkout stats are stable; flags, attributes and changed selection remain semantic inputs", async () => {
    const repository = await mkdtemp(
      path.join(tmpdir(), "root-input-semantics-"),
    );
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], { cwd: repository });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      return result.stdout.toString().trim();
    };
    try {
      git("init", "--quiet");
      await Bun.write(path.join(repository, "source.ts"), "const value = 1;\n");
      await Bun.write(
        path.join(repository, ".gitattributes"),
        "*.ts text eol=lf\n",
      );
      git("add", ".");
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "base",
      );
      const base = git("rev-parse", "HEAD");
      const original = await rootCheckInputsHash({}, repository);
      await utimes(
        path.join(repository, "source.ts"),
        new Date(0),
        new Date(0),
      );
      git("update-index", "--refresh");
      expect(await rootCheckInputsHash({}, repository)).toBe(original);
      git("update-index", "--assume-unchanged", "source.ts");
      expect(await rootCheckInputsHash({}, repository)).not.toBe(original);
      git("update-index", "--no-assume-unchanged", "source.ts");
      await Bun.write(
        path.join(repository, ".git/info/attributes"),
        "*.ts -text\n",
      );
      expect(await rootCheckInputsHash({}, repository)).not.toBe(original);
      await Bun.write(path.join(repository, ".git/info/attributes"), "");
      await Bun.write(path.join(repository, "new.ts"), "const value = 2;\n");
      git("add", ".");
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "child",
      );
      const environment = { CI_CHANGED_BASE: base };
      const child = await rootCheckInputsHash(environment, repository);
      // Move only HEAD: worktree and index remain identical, but base..HEAD
      // now selects no files. A cached changed-file pass must not cross this.
      git("update-ref", "HEAD", base);
      expect(await rootCheckInputsHash(environment, repository)).not.toBe(
        child,
      );
      const fresh = await rootCheckEnvironment(
        { ...environment, CI_ROOT_CHECK_INPUTS_SHA256: "stale" },
        repository,
      );
      expect(fresh["CI_ROOT_CHECK_INPUTS_SHA256"]).toBe(
        await rootCheckInputsHash(environment, repository),
      );
      await expect(
        assertRootCheckInputs({ ...fresh, TURBO_HASH: "task" }, repository),
      ).resolves.toBeUndefined();
      await expect(
        assertRootCheckInputs({ TURBO_HASH: "task" }, repository),
      ).rejects.toThrow("freshly fingerprinted");
      await expect(
        assertRootCheckInputs(
          {
            ...fresh,
            CI_ROOT_CHECK_INPUTS_SHA256: "a".repeat(64),
            TURBO_HASH: "task",
          },
          repository,
        ),
      ).rejects.toThrow("freshly fingerprinted");
      await expect(
        assertRootCheckInputs({}, repository),
      ).resolves.toBeUndefined();
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  test("direct Turbo execution without the producer cannot cache a passing root check", async () => {
    const script = path.join(import.meta.dir, "run-shard-check.ts");
    for (const key of [undefined, "bad", "a".repeat(64)]) {
      const result = Bun.spawnSync(["bun", script, "large-files", "root"], {
        env: {
          ...Bun.env,
          TURBO_HASH: "probe-task",
          CI_ROOT_CHECK_INPUTS_SHA256: key,
        },
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("freshly fingerprinted");
    }
  });
});
