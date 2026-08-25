import { describe, expect, test } from "vitest";
import {
  manifestStepViolations,
  packageScriptViolations,
  sourceViolation,
} from "./check-test-standardization.ts";
import type { TestStep } from "./ci-reporting.ts";

describe("test standardization guard", () => {
  test("rejects Bun and Node test imports", () => {
    expect(
      sourceViolation("a.test.ts", 'import { test } from "bun:test";'),
    ).toContain("vitest");
    expect(
      sourceViolation("b.test.ts", 'import test from "node:test";'),
    ).toContain("vitest");
    expect(
      sourceViolation("c.test.ts", 'import { test } from "vitest";'),
    ).toBeUndefined();
    expect(
      sourceViolation("runner.ts", 'Bun.spawn(["bun", "test", "src"]);'),
    ).toContain("Vitest");
  });

  test("rejects native Bun test scripts", () => {
    expect(
      packageScriptViolations("package.json", {
        scripts: { test: "bun --env-file=.env test src" },
      }),
    ).toHaveLength(1);
    expect(
      packageScriptViolations("package.json", {
        scripts: {
          test: "bun --no-install --bun vitest run",
          nested: "bun run test",
        },
      }),
    ).toEqual([]);
  });

  test("requires Bun's Playwright runtime", () => {
    expect(
      packageScriptViolations("package.json", {
        scripts: { e2e: "playwright test" },
      }),
    ).toHaveLength(1);
    expect(
      packageScriptViolations("package.json", {
        scripts: { e2e: "bun --no-install --bun playwright test" },
      }),
    ).toEqual([]);
  });

  test("limits Node-hosted Vitest to the documented Temporal SDK suite", () => {
    const temporalStep: TestStep = {
      runner: "vitest",
      name: "workflows",
      runtime: "node",
      runtimeReason: "Temporal workers require Node runtime primitives.",
      args: [
        "src/workflows",
        "--exclude",
        "src/workflows/agent-task.test.ts",
        "--no-file-parallelism",
      ],
    };

    expect(
      manifestStepViolations("@shepherdjerred/temporal", [temporalStep]),
    ).toEqual([]);
    expect(
      manifestStepViolations("@scout-for-lol/temporal", [
        {
          ...temporalStep,
          args: ["src/workflows", "--no-file-parallelism"],
        },
      ]),
    ).toEqual([]);
    expect(
      manifestStepViolations("other-package", [temporalStep]),
    ).toHaveLength(1);
    expect(
      manifestStepViolations("@shepherdjerred/temporal", [
        {
          runner: "vitest",
          name: "workflows",
          runtime: "node",
          args: [
            "src/workflows",
            "--exclude",
            "src/workflows/agent-task.test.ts",
          ],
        },
      ]),
    ).toHaveLength(1);
  });
});
