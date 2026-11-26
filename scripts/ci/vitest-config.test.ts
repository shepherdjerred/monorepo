import { mkdir, mkdtemp, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { minimatch } from "minimatch";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import defaultVitestConfig from "../../vitest.config.ts";

const { createVitestConfig } = defaultVitestConfig;

describe("vitest.config.ts", () => {
  let directory = "";

  afterEach(async () => {
    if (directory !== "") {
      await rm(directory, { recursive: true, force: true });
      directory = "";
    }
  });

  test("excludes nested .claude/worktrees/** and .codex/** checkouts while keeping primary checkout tests", () => {
    const config = createVitestConfig({ mode: "test", command: "serve" });
    expect(config.test.exclude).toEqual(
      expect.arrayContaining(["**/.claude/worktrees/**", "**/.codex/**"]),
    );

    const matchesExclude = (candidate: string): boolean =>
      config.test.exclude.some((pattern) =>
        minimatch(candidate, pattern, { dot: true }),
      );

    expect(
      matchesExclude(
        ".claude/worktrees/subagent-1/scripts/ci/publish-delivery.test.ts",
      ),
    ).toBe(true);
    expect(
      matchesExclude(".codex/worktrees/worker/scripts/ci/verify.test.ts"),
    ).toBe(true);
    expect(matchesExclude("scripts/ci/publish-delivery.test.ts")).toBe(false);
    expect(matchesExclude("packages/temporal/src/worker-config.test.ts")).toBe(
      false,
    );
  });

  test("isolates cacheDir and fsModuleCachePath per workspace, tier, and runtime inside node_modules/.vitest-cache", () => {
    const repoRoot = "/app";
    const sharedCacheRoot = path.join(
      repoRoot,
      "node_modules",
      ".vitest-cache",
    );
    const baseOptions = {
      repositoryRoot: repoRoot,
      runtime: "bun-1.4.5",
      resolveVitestRealpath: () =>
        "/app/node_modules/.bun/vitest@5.0.5+441ecf710ce58215/node_modules/vitest/package.json",
      readDirMtime: () => "1700000000000",
    };

    const rootConfig = createVitestConfig({
      ...baseOptions,
      workspaceRoot: "/app",
      tier: "ci",
    });
    const mediaExtended = createVitestConfig({
      ...baseOptions,
      workspaceRoot: "/app/packages/media",
      tier: "extended",
    });
    const temporalExtended = createVitestConfig({
      ...baseOptions,
      workspaceRoot: "/app/packages/temporal",
      tier: "extended",
    });
    const temporalCi = createVitestConfig({
      ...baseOptions,
      workspaceRoot: "/app/packages/temporal",
      tier: "ci",
    });
    const temporalNodeWorkflows = createVitestConfig({
      ...baseOptions,
      workspaceRoot: "/app/packages/temporal",
      tier: "extended",
      runtime: "node-24.22.3",
    });

    expect(temporalExtended.test.setupFiles).toEqual([
      "/app/packages/temporal/test-setup.ts",
    ]);
    expect(rootConfig.cacheDir).toContain("root-ci-");
    expect(temporalExtended.cacheDir).toContain("packages__temporal-extended-");

    const allPaths = [
      rootConfig.cacheDir,
      rootConfig.test.fsModuleCachePath,
      mediaExtended.cacheDir,
      mediaExtended.test.fsModuleCachePath,
      temporalExtended.cacheDir,
      temporalExtended.test.fsModuleCachePath,
      temporalCi.cacheDir,
      temporalCi.test.fsModuleCachePath,
      temporalNodeWorkflows.cacheDir,
      temporalNodeWorkflows.test.fsModuleCachePath,
    ];
    expect(new Set(allPaths).size).toBe(allPaths.length);
    for (const candidate of allPaths) {
      expect(candidate.startsWith(`${sharedCacheRoot}${path.sep}`)).toBe(true);
    }
  });

  test("invalidates cache paths when resolved vitest peer-hash symlink realpath changes", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "vitest-peer-hash-"));
    const oldPeerDir = path.join(
      directory,
      "node_modules",
      ".bun",
      "vitest@5.0.5+fdeda39a862ede84",
      "node_modules",
      "vitest",
    );
    const newPeerDir = path.join(
      directory,
      "node_modules",
      ".bun",
      "vitest@5.0.5+441ecf710ce58215",
      "node_modules",
      "vitest",
    );
    const workspaceRoot = path.join(directory, "packages", "temporal");
    const workspaceNodeModules = path.join(workspaceRoot, "node_modules");
    await mkdir(oldPeerDir, { recursive: true });
    await mkdir(newPeerDir, { recursive: true });
    await mkdir(workspaceNodeModules, { recursive: true });
    await Bun.write(
      path.join(oldPeerDir, "package.json"),
      '{"name":"vitest","version":"5.0.5"}\n',
    );
    await Bun.write(
      path.join(newPeerDir, "package.json"),
      '{"name":"vitest","version":"5.0.5"}\n',
    );

    const vitestLink = path.join(workspaceNodeModules, "vitest");
    await symlink(oldPeerDir, vitestLink);

    const beforeConfig = createVitestConfig({
      repositoryRoot: directory,
      workspaceRoot,
      readDirMtime: () => "1700000000000",
    });
    const repeatBeforeConfig = createVitestConfig({
      repositoryRoot: directory,
      workspaceRoot,
      readDirMtime: () => "1700000000000",
    });
    expect(repeatBeforeConfig.cacheDir).toBe(beforeConfig.cacheDir);
    expect(repeatBeforeConfig.test.fsModuleCachePath).toBe(
      beforeConfig.test.fsModuleCachePath,
    );

    await unlink(vitestLink);
    await symlink(newPeerDir, vitestLink);

    const afterConfig = createVitestConfig({
      repositoryRoot: directory,
      workspaceRoot,
      readDirMtime: () => "1700000000000",
    });
    expect(afterConfig.cacheDir).not.toBe(beforeConfig.cacheDir);
    expect(afterConfig.test.fsModuleCachePath).not.toBe(
      beforeConfig.test.fsModuleCachePath,
    );
  });

  test("exports a plain config object as default so packages/the-storm/vitest.e2e.config.ts loads cleanly", async () => {
    expect(typeof defaultVitestConfig).toBe("object");
    expect(defaultVitestConfig).not.toBeNull();

    const stormConfigPath = path.join(
      import.meta.dirname,
      "..",
      "..",
      "packages",
      "the-storm",
      "vitest.e2e.config.ts",
    );
    const StormConfigModuleSchema = z.object({
      default: z.object({
        cacheDir: z.string(),
        test: z.object({
          include: z.array(z.string()),
          fsModuleCachePath: z.string(),
          fileParallelism: z.boolean(),
        }),
      }),
    });

    const stormModule: unknown = await import(stormConfigPath);
    const parsed = StormConfigModuleSchema.parse(stormModule);
    expect(parsed.default.test.include).toContain("tests/e2e/**/*.e2e.test.ts");
    expect(parsed.default.test.fileParallelism).toBe(false);
    expect(parsed.default.cacheDir.length).toBeGreaterThan(0);
    expect(parsed.default.test.fsModuleCachePath.length).toBeGreaterThan(0);
  });
});
