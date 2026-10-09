import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  mstestConfiguration,
  prepareMstestConfiguration,
} from "./mstest-configuration.ts";
import { TestManifestSchema } from "./ci-reporting.ts";

describe("shared MSTest configuration", () => {
  test("preserves randomization, enforced timeouts, and strict failures", () => {
    expect(
      mstestConfiguration({
        artifacts: "/reports",
        parallel: true,
        timeoutMs: 30_000,
        seed: 42,
      }),
    ).toEqual({
      platformOptions: {
        exitProcessOnUnhandledException: true,
        resultDirectory: "/reports",
      },
      mstest: {
        parallelism: { enabled: true, workers: 0, scope: "method" },
        timeout: {
          test: 30_000,
          testInitialize: 30_000,
          testCleanup: 30_000,
          useCooperativeCancellation: false,
        },
        execution: {
          mapInconclusiveToFailed: true,
          mapNotRunnableToFailed: true,
          randomizeTestOrder: true,
          randomTestOrderSeed: 42,
          treatClassAndAssemblyCleanupWarningsAsErrors: true,
          treatDiscoveryWarningsAsErrors: true,
        },
      },
    });
  });

  test.each(["-1", "NaN", "1.2"])(
    "rejects invalid seed %s",
    async (seedRaw) => {
      await expect(
        prepareMstestConfiguration({
          artifacts: "/unused",
          parallel: false,
          timeoutMs: 120_000,
          seedRaw,
        }),
      ).rejects.toThrow("non-negative integer");
    },
  );

  test("writes the same config for native and portable callers", async () => {
    const artifacts = await mkdtemp(path.join(os.tmpdir(), "mstest-config-"));
    try {
      const file = await prepareMstestConfiguration({
        artifacts,
        parallel: false,
        timeoutMs: 120_000,
        seedRaw: "123",
      });
      expect(await Bun.file(file).json()).toEqual(
        mstestConfiguration({
          artifacts,
          parallel: false,
          timeoutMs: 120_000,
          seed: 123,
        }),
      );
    } finally {
      await rm(artifacts, { recursive: true, force: true });
    }
  });

  test("CI instruments both portable suites once with their existing limits", async () => {
    const manifest = TestManifestSchema.parse(
      await Bun.file(
        path.join(import.meta.dir, "..", "ci-test-manifest.json"),
      ).json(),
    );
    const windows = manifest.workspaces.find(
      (workspace) => workspace.package === "tasknotes-windows",
    );
    expect(windows?.coverageAlways).toBe(true);
    expect(windows?.steps).toEqual([
      expect.objectContaining({
        runner: "dotnet",
        name: "unit",
        args: [
          "tests/TaskNotes.Windows.Tests/TaskNotes.Windows.Tests.csproj",
          "--configuration",
          "Release",
          "--property:RestoreLockedMode=true",
        ],
        coverageConfig: "coverage.settings.xml",
        mstest: { parallel: true, timeoutMs: 30_000 },
      }),
      expect.objectContaining({
        runner: "dotnet",
        name: "integration",
        args: [
          "tests/TaskNotes.Windows.IntegrationTests/TaskNotes.Windows.IntegrationTests.csproj",
          "--configuration",
          "Release",
          "--property:RestoreLockedMode=true",
        ],
        coverageConfig: "coverage.settings.xml",
        mstest: { parallel: true, timeoutMs: 120_000 },
      }),
    ]);
    expect(windows?.excludedSuites).toHaveLength(2);
  });
});
