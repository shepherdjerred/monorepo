import { describe, expect, test } from "vitest";

import {
  dockerWorkspaceMounts,
  dockerRunnerSource,
  dockerRunnerCommand,
  DockerAgentRunner,
} from "#src/host/docker.ts";
import { ConfigSchema } from "#src/domain/schemas.ts";
import type { CommandRunner } from "#src/runtime/process.ts";

describe("dockerWorkspaceMounts", () => {
  test("keeps host Git metadata read-only inside the container", () => {
    expect(dockerWorkspaceMounts("/tmp/task")).toEqual([
      "--volume",
      "/tmp/task:/workspace",
      "--volume",
      "/tmp/task/.git:/workspace/.git:ro",
    ]);
  });
});

describe("host verification container", () => {
  test.each([0, 1])(
    "publishes evidence only on success and always cleans up (exit %i)",
    async (exitCode) => {
      const config = ConfigSchema.parse(
        await Bun.file(
          new URL("../../config.example.json", import.meta.url),
        ).json(),
      );
      config.docker.image = "fixture/image";
      const commands: string[][] = [];
      const run: CommandRunner = async (args) => {
        commands.push([...args]);
        let stdout = "";
        if (args[0] === "git")
          stdout = JSON.stringify(
            args[2] === "origin/main:package.json"
              ? { workspaces: ["packages/toolkit"] }
              : { name: "@shepherdjerred/toolkit" },
          );
        const failed = args.includes("turbo") && exitCode !== 0;
        return {
          exitCode: failed ? exitCode : 0,
          stdout,
          stderr: failed ? "Fixture test failure" : "",
          timedOut: false,
        };
      };
      const result = new DockerAgentRunner(config, run).verifyWorkspace(
        "/tmp/task",
        ["packages/toolkit/src/file.ts"],
      );
      if (exitCode === 0)
        await expect(result).resolves.toEqual([
          "PASSED: bun --no-install --bun turbo run build typecheck test lint --filter=@shepherdjerred/toolkit",
        ]);
      else await expect(result).rejects.toThrow("Fixture test failure");
      const verification = commands.find((args) => args.includes("turbo"));
      expect(verification).toContain("/tmp/task/.git:/workspace/.git:ro");
      expect(verification).not.toContain("--env");
      expect(commands.at(-1)?.slice(0, 3)).toEqual(["docker", "rm", "--force"]);
    },
  );
});

describe("local container source", () => {
  test("mounts local source read-only separately from the editable task", () => {
    expect(dockerRunnerSource("/tmp/local justin")).toEqual([
      "--volume",
      "/tmp/local justin/src:/jpe-runner/src:ro",
      "--volume",
      "/tmp/local justin/package.json:/jpe-runner/package.json:ro",
    ]);
    expect(dockerRunnerCommand("/tmp/local justin").at(-1)).toContain(
      "/workspace/packages/justin-principal-engineer/node_modules",
    );
    expect(dockerRunnerCommand("/tmp/local justin").at(-1)).toContain(
      "exec bun /jpe-runner/src/container-entry.ts",
    );
  });

  test("normal reconcile keeps the existing task-clone runner", () => {
    expect(dockerRunnerSource(undefined)).toEqual([]);
    expect(dockerRunnerCommand(undefined)).toEqual([
      "bun",
      "run",
      "--cwd",
      "packages/justin-principal-engineer",
      "container",
    ]);
  });
});
