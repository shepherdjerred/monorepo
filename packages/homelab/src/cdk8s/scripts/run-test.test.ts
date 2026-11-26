import { describe, expect, it } from "vitest";
import {
  buildTestCommands,
  executeTestCommand,
  runCdk8sTests,
  type TestCommand,
} from "./run-test.ts";

describe("cdk8s test runner wrapper", () => {
  it("forwards file/filter arguments to vitest and skips test:gpu-resources", async () => {
    const invoked: TestCommand[] = [];
    const exitCode = await runCdk8sTests(
      [
        "src/resources/argo-applications/observability/tempo.test.ts",
        "-t",
        "Tempo",
      ],
      async (command) => {
        invoked.push(command);
        return 0;
      },
      "/repo/packages/homelab/src/cdk8s",
    );

    expect(exitCode).toBe(0);
    expect(invoked).toEqual([
      {
        cmd: [
          "bun",
          "--no-install",
          "--bun",
          "vitest",
          "--config",
          "../../../../vitest.config.ts",
          "run",
          "src/resources/argo-applications/observability/tempo.test.ts",
          "-t",
          "Tempo",
        ],
        cwd: "/repo/packages/homelab/src/cdk8s",
      },
    ]);
  });

  it("runs both vitest and test:gpu-resources when invoked without arguments", async () => {
    const invoked: TestCommand[] = [];
    const exitCode = await runCdk8sTests(
      [],
      async (command) => {
        invoked.push(command);
        return 0;
      },
      "/repo/packages/homelab/src/cdk8s",
    );

    expect(exitCode).toBe(0);
    expect(invoked).toEqual([
      {
        cmd: [
          "bun",
          "--no-install",
          "--bun",
          "vitest",
          "--config",
          "../../../../vitest.config.ts",
          "run",
        ],
        cwd: "/repo/packages/homelab/src/cdk8s",
      },
      {
        cmd: ["bun", "run", "test:gpu-resources"],
        cwd: "/repo/packages/homelab/src/cdk8s",
      },
    ]);
  });

  it("stops before test:gpu-resources when vitest exits non-zero", async () => {
    const invoked: TestCommand[] = [];
    const exitCode = await runCdk8sTests(
      [],
      async (command) => {
        invoked.push(command);
        return 1;
      },
      "/repo/packages/homelab/src/cdk8s",
    );

    expect(exitCode).toBe(1);
    expect(invoked).toHaveLength(1);
  });

  it("builds commands with default package cwd and executes subprocesses cleanly", async () => {
    expect(buildTestCommands(["foo.test.ts"])[0]?.cmd.at(-1)).toBe(
      "foo.test.ts",
    );
    const code = await executeTestCommand({
      cmd: [process.execPath, "-e", "process.exit(0)"],
      cwd: import.meta.dir,
    });
    expect(code).toBe(0);
  });
});
