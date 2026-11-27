import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { SHARD_NAMES } from "./repo-shards.ts";
import {
  assertPrettierChangedDigest,
  changedFilesForShard,
  chunk,
  parseCheckName,
  parseTrackedEntry,
  PRETTIER_CHANGED_ENV_KEYS,
  prettierChangedDigest,
  prettierChangedEnvironment,
  prettierDigestedFiles,
  prettierDigestForFiles,
  runShardCheck,
  shardTrackedFiles,
  trackedFiles,
} from "./run-shard-check.ts";

type RanCommand = string[];

beforeEach(() => {
  vi.stubEnv("CI_FORMAT_CACHE_ROOT", "");
});
afterEach(() => vi.unstubAllEnvs());

function recordingRunner(ran: RanCommand[]) {
  return async (cmd: string[]) => {
    ran.push(cmd);
    return { stdout: "", stderr: "", exitCode: 0 };
  };
}

describe("parseCheckName", () => {
  test("accepts the sharded checks", () => {
    expect(parseCheckName("prettier")).toBe("prettier");
    expect(parseCheckName("line-endings")).toBe("line-endings");
    expect(parseCheckName("large-files")).toBe("large-files");
  });

  test("rejects unknown checks with the valid list", () => {
    expect(() => parseCheckName("gitleaks")).toThrow(/prettier/);
  });
});

describe("parseTrackedEntry", () => {
  test("splits mode and path on the tab", () => {
    expect(
      parseTrackedEntry(`100644 ${"a".repeat(40)} 0\tscripts/verify.ts`),
    ).toEqual({ mode: "100644", path: "scripts/verify.ts" });
  });

  test("returns null for tabless records", () => {
    expect(parseTrackedEntry("garbage")).toBeNull();
  });
});

describe("chunk", () => {
  test("splits into bounded pieces preserving order", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("returns nothing for an empty list", () => {
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("shardTrackedFiles", () => {
  test("resolves existing tracked files and never symlinks", async () => {
    const files = await shardTrackedFiles("root");
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("scripts/verify.ts");
    // CLAUDE.md is the repo's standing symlink (to AGENTS.md); prettier
    // errors on explicitly-passed symlinks, so it must be filtered here.
    expect(files).not.toContain("CLAUDE.md");
    for (const file of files) {
      expect(file.startsWith("packages/")).toBe(false);
    }
  });
});

async function withRepository(
  body: (repository: string) => Promise<void>,
): Promise<void> {
  const repository = await mkdtemp(path.join(tmpdir(), "tracked-files-"));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: repository });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  };
  try {
    git("init", "--quiet");
    await Bun.write(path.join(repository, "a.ts"), "a;\n");
    await Bun.write(path.join(repository, "b.ts"), "b;\n");
    await Bun.write(path.join(repository, "gone.ts"), "gone;\n");
    await symlink("a.ts", path.join(repository, "link.ts"));
    git("add", ".");
    await unlink(path.join(repository, "gone.ts"));
    await body(repository);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
}

describe("trackedFiles against a real git repository", () => {
  test("an empty pathspec list selects nothing instead of every tracked file", async () => {
    await withRepository(async (repository) => {
      expect(await trackedFiles([], repository)).toEqual([]);
      // Control: the same repository does list its files when asked.
      expect(await trackedFiles(["."], repository)).toEqual(["a.ts", "b.ts"]);
    });
  });

  test("only the named files come back, minus symlinks and deleted paths", async () => {
    await withRepository(async (repository) => {
      expect(
        await trackedFiles(["b.ts", "link.ts", "gone.ts"], repository),
      ).toEqual(["b.ts"]);
    });
  });
});

describe("runShardCheck", () => {
  test.each(["", " \t "])(
    "empty cache setting %j runs formatting without caching",
    async (value) => {
      vi.stubEnv("CI_FORMAT_CACHE_ROOT", value);
      try {
        const ran: RanCommand[] = [];
        await runShardCheck("prettier", "root", {
          runner: recordingRunner(ran),
          fileResolver: async () => ["package.json"],
          changedFileResolver: () => null,
        });
        expect(ran).toEqual([
          [
            "bunx",
            "--no-install",
            "prettier",
            "--check",
            "--ignore-unknown",
            "package.json",
          ],
        ]);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
  test("prettier runs chunked over the resolved shard files", async () => {
    const ran: RanCommand[] = [];
    const files = Array.from({ length: 1001 }, (_, i) => `file-${String(i)}`);
    await runShardCheck("prettier", "scout", {
      runner: recordingRunner(ran),
      fileResolver: async () => files,
    });
    expect(ran.length).toBe(2);
    const first = ran[0] ?? [];
    expect(first.slice(0, 5)).toEqual([
      "bunx",
      "--no-install",
      "prettier",
      "--check",
      "--ignore-unknown",
    ]);
    expect(first.length).toBe(5 + 1000);
    expect(ran[1]?.length).toBe(5 + 1);
  });

  test("prettier is a no-op for an empty shard", async () => {
    const ran: RanCommand[] = [];
    await runShardCheck("prettier", "scout", {
      runner: recordingRunner(ran),
      fileResolver: async () => [],
    });
    expect(ran).toEqual([]);
  });

  test("git-index checks receive the shard pathspecs verbatim", async () => {
    const ran: RanCommand[] = [];
    await runShardCheck("line-endings", "packages", {
      runner: recordingRunner(ran),
    });
    expect(ran).toEqual([
      [
        "bun",
        "--no-install",
        "scripts/checks/check-line-endings.ts",
        "packages",
        ":(exclude)packages/scout-for-lol",
        ":(exclude)packages/homelab",
      ],
    ]);
  });

  test("large-files targets its own script", async () => {
    const ran: RanCommand[] = [];
    await runShardCheck("large-files", "homelab", {
      runner: recordingRunner(ran),
    });
    expect(ran).toEqual([
      [
        "bun",
        "--no-install",
        "scripts/checks/check-large-files.ts",
        "packages/homelab",
      ],
    ]);
  });

  test("git-index checks receive only changed files when a base is available", async () => {
    const ran: RanCommand[] = [];
    await runShardCheck("line-endings", "packages", {
      runner: recordingRunner(ran),
      changedFileResolver: async () => [
        "packages/alert-dashboard/src/index.ts",
      ],
    });
    expect(ran).toEqual([
      [
        "bun",
        "--no-install",
        "scripts/checks/check-line-endings.ts",
        "packages/alert-dashboard/src/index.ts",
      ],
    ]);
  });

  test("a shard with no changed files performs no work", async () => {
    const ran: RanCommand[] = [];
    await runShardCheck("large-files", "homelab", {
      runner: recordingRunner(ran),
      changedFileResolver: async () => [],
    });
    expect(ran).toEqual([]);
  });

  test("prettier with the real resolver formats nothing when no shard file changed", async () => {
    // No fileResolver override: an empty changed list must reach the real
    // git-backed resolver and short-circuit, not list the whole repository.
    const ran: RanCommand[] = [];
    await runShardCheck("prettier", "scout", {
      runner: recordingRunner(ran),
      changedFileResolver: () => [],
    });
    expect(ran).toEqual([]);
  });

  test("prettier with the real resolver checks exactly the changed files", async () => {
    const ran: RanCommand[] = [];
    await runShardCheck("prettier", "root", {
      runner: recordingRunner(ran),
      changedFileResolver: () => [
        "scripts/verify.ts",
        "scripts/not-tracked.ts",
      ],
    });
    expect(ran).toEqual([
      [
        "bunx",
        "--no-install",
        "prettier",
        "--check",
        "--ignore-unknown",
        "scripts/verify.ts",
      ],
    ]);
  });
});

describe("changedFilesForShard", () => {
  test("an unusable base selects the whole shard", () => {
    expect(changedFilesForShard("prettier", "root", {})).toBeNull();
    expect(
      changedFilesForShard("prettier", "root", {
        CI_CHANGED_BASE: "0".repeat(40),
      }),
    ).toBeNull();
  });

  test("HEAD as the base changes nothing in any shard", () => {
    for (const shard of ["scout", "homelab", "packages", "root"] as const) {
      expect(
        changedFilesForShard("prettier", shard, { CI_CHANGED_BASE: "HEAD" }),
      ).toEqual([]);
    }
  });
});

// A shallow checkout may lack older commits, so derive bases from HEAD itself.
function gitOutput(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: import.meta.dir,
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return result.stdout.toString().trim();
}

const BUILD_FILE = "packages/mc-harness/src/build/apply.ts";

async function withShardRepository(
  body: (repository: string, git: (...args: string[]) => void) => Promise<void>,
): Promise<void> {
  const repository = await mkdtemp(path.join(tmpdir(), "prettier-digest-"));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: repository });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  };
  try {
    git("init", "--quiet");
    for (const [file, content] of Object.entries({
      [BUILD_FILE]: "const a = 1;\n",
      "packages/other/src/index.ts": "const b = 1;\n",
      ".editorconfig": "root = true\n",
      ".prettierrc.json": "{}\n",
    })) {
      await Bun.write(path.join(repository, file), content);
    }
    git("add", ".");
    await body(repository, git);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
}

describe("prettierChangedDigest", () => {
  test("is a `full` digest whenever the base is unusable, so the shard runs in full", async () => {
    for (const shard of SHARD_NAMES) {
      expect(await prettierChangedDigest(shard, {})).toMatch(
        /^full-[a-f0-9]{64}$/u,
      );
      expect(
        await prettierChangedDigest(shard, { CI_CHANGED_BASE: "f".repeat(40) }),
      ).toMatch(/^full-[a-f0-9]{64}$/u);
    }
  });

  test("an unchanged shard hashes the same whichever base reached the same diff", async () => {
    const head = gitOutput("rev-parse", "HEAD");
    const symbolic = await prettierChangedDigest("scout", {
      CI_CHANGED_BASE: "HEAD",
    });
    const explicit = await prettierChangedDigest("scout", {
      CI_CHANGED_BASE: head,
    });
    expect(symbolic).toMatch(/^changed-[a-f0-9]{64}$/u);
    expect(explicit).toBe(symbolic);
  });

  test("the environment has one key per shard", async () => {
    const environment = await prettierChangedEnvironment({});
    expect(Object.keys(environment).sort()).toEqual(
      Object.values(PRETTIER_CHANGED_ENV_KEYS).sort(),
    );
  });
});

describe("prettierDigestForFiles is content addressed", () => {
  test("an edit under a Turbo-excluded directory changes the digest for the same changed list", async () => {
    await withShardRepository(async (repository, git) => {
      const before = await prettierDigestForFiles(
        "packages",
        [BUILD_FILE],
        repository,
      );
      // Unstaged edit: Prettier reads the working tree.
      await Bun.write(path.join(repository, BUILD_FILE), "const a   =   2;\n");
      const unstaged = await prettierDigestForFiles(
        "packages",
        [BUILD_FILE],
        repository,
      );
      expect(unstaged).not.toBe(before);
      git("add", BUILD_FILE);
      const staged = await prettierDigestForFiles(
        "packages",
        [BUILD_FILE],
        repository,
      );
      expect(staged).not.toBe(before);
      expect(staged).not.toBe(unstaged);
    });
  });

  test("an edit to a file outside the changed list does not change the digest", async () => {
    await withShardRepository(async (repository) => {
      const before = await prettierDigestForFiles(
        "packages",
        [BUILD_FILE],
        repository,
      );
      await Bun.write(
        path.join(repository, "packages/other/src/index.ts"),
        "const b   =   2;\n",
      );
      expect(
        await prettierDigestForFiles("packages", [BUILD_FILE], repository),
      ).toBe(before);
    });
  });

  test("a full digest covers every file of the shard and the formatting config", async () => {
    await withShardRepository(async (repository, git) => {
      const full = await prettierDigestForFiles("packages", null, repository);
      await Bun.write(
        path.join(repository, "packages/other/src/index.ts"),
        "const b   =   2;\n",
      );
      const afterFile = await prettierDigestForFiles(
        "packages",
        null,
        repository,
      );
      expect(afterFile).not.toBe(full);
      // A root .editorconfig is not an input of the packages task but forces a
      // full run, so the full digest must change with it.
      await Bun.write(
        path.join(repository, ".editorconfig"),
        "root = true\n[*]\n",
      );
      git("add", ".editorconfig");
      expect(
        await prettierDigestForFiles("packages", null, repository),
      ).not.toBe(afterFile);
    });
  });
});

const TurboConfigSchema = z.object({
  tasks: z.record(
    z.string(),
    z.object({
      inputs: z.array(z.string()).optional(),
      env: z.array(z.string()).optional(),
    }),
  ),
});

function matchesTurboInputs(inputs: readonly string[], file: string) {
  const included = inputs
    .filter((input) => !input.startsWith("!"))
    .some((input) => new Bun.Glob(input).match(file));
  return (
    included &&
    !inputs
      .filter((input) => input.startsWith("!"))
      .some((input) => new Bun.Glob(input.slice(1)).match(file))
  );
}

describe("every file Prettier checks is covered by its shard's Turbo inputs or digest", () => {
  test.each(SHARD_NAMES)("%s", async (shard) => {
    const turbo = TurboConfigSchema.parse(
      Bun.JSONC.parse(
        await Bun.file(
          path.join(import.meta.dir, "..", "..", "turbo.json"),
        ).text(),
      ),
    );
    const task = turbo.tasks[`//#prettier-${shard}`];
    expect(task?.env).toContain(PRETTIER_CHANGED_ENV_KEYS[shard]);
    const inputs = task?.inputs ?? [];
    const files = await shardTrackedFiles(shard);
    expect(files.length).toBeGreaterThan(0);
    const digestOnly = files.filter(
      (file) => !matchesTurboInputs(inputs, file),
    );
    // The digest hashes every tracked file of a full run and each changed file
    // of a partial one, so files Turbo's globs miss are still covered. This
    // pins the known gap so a new one is noticed and a closed one is cleaned up.
    if (shard === "packages") {
      expect(digestOnly).toContain(BUILD_FILE);
    }
    const covered = new Set(prettierDigestedFiles(shard, null));
    expect(digestOnly.filter((file) => !covered.has(file))).toEqual([]);
    const [sample] = digestOnly;
    if (sample !== undefined) {
      expect(prettierDigestedFiles(shard, [sample])).toEqual([sample]);
    }
  });
});

describe("assertPrettierChangedDigest", () => {
  const base = { CI_CHANGED_BASE: "HEAD" };

  test("does nothing outside Turbo", async () => {
    await expect(
      assertPrettierChangedDigest("scout", base),
    ).resolves.toBeUndefined();
  });

  test("under Turbo it requires the digest verify.ts computes for this checkout", async () => {
    const fresh = await prettierChangedEnvironment(base);
    const turbo = { ...base, TURBO_HASH: "task" };
    await expect(
      assertPrettierChangedDigest("scout", { ...turbo, ...fresh }),
    ).resolves.toBeUndefined();
    await expect(assertPrettierChangedDigest("scout", turbo)).rejects.toThrow(
      "freshly computed",
    );
    await expect(
      assertPrettierChangedDigest("scout", {
        ...turbo,
        CI_PRETTIER_SCOUT_CHANGED_SHA256: "changed-stale",
      }),
    ).rejects.toThrow("freshly computed");
  });
});
