import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { temporalWorkflowVitestNodeArgs } from "#scripts/test-workflows.ts";

const CiTestsManifestSchema = z.object({
  steps: z.array(
    z
      .object({
        name: z.string().optional(),
        runner: z.string(),
        args: z.array(z.string()).optional(),
      })
      .loose(),
  ),
});

describe("temporalWorkflowVitestNodeArgs", () => {
  test("passes --no-file-parallelism and stays aligned with ci-tests.json workflows step", async () => {
    const packageRoot = path.resolve(import.meta.dirname, "..");
    const repositoryRoot = path.resolve(packageRoot, "../..");
    const manifest = CiTestsManifestSchema.parse(
      await Bun.file(path.join(packageRoot, "ci-tests.json")).json(),
    );
    const workflowsStep = manifest.steps.find(
      (step) => step.name === "workflows",
    );
    expect(workflowsStep?.args).toEqual([
      "src/workflows",
      "--no-file-parallelism",
    ]);

    const nodeArgs = temporalWorkflowVitestNodeArgs({
      packageRoot,
      repositoryRoot,
    });
    expect(nodeArgs).toEqual([
      path.join(packageRoot, "node_modules", "vitest", "vitest.mjs"),
      "--config",
      path.join(repositoryRoot, "vitest.config.ts"),
      "run",
      ...(workflowsStep?.args ?? []),
    ]);
    expect(nodeArgs).not.toContain("--exclude");
    expect(nodeArgs).not.toContain("src/workflows/agent-task.test.ts");
  });

  test("replaces default src/workflows target when an explicit workflow file is passed", () => {
    const nodeArgs = temporalWorkflowVitestNodeArgs({
      packageRoot: "/repo/packages/temporal",
      repositoryRoot: "/repo",
      extraArgs: ["src/workflows/agent-task.test.ts"],
    });
    expect(nodeArgs.slice(-3)).toEqual([
      "run",
      "--no-file-parallelism",
      "src/workflows/agent-task.test.ts",
    ]);
  });

  test("keeps default src/workflows target when only CLI flags are forwarded", () => {
    const nodeArgs = temporalWorkflowVitestNodeArgs({
      packageRoot: "/repo/packages/temporal",
      repositoryRoot: "/repo",
      extraArgs: ["--reporter=verbose"],
    });
    expect(nodeArgs.slice(-3)).toEqual([
      "src/workflows",
      "--no-file-parallelism",
      "--reporter=verbose",
    ]);
  });
});
