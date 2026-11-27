import os from "node:os";
import { describe, expect, test } from "vitest";
import {
  PROD_IMAGE,
  SMOKE_IMAGE,
  buildProdContainerRunCommand,
  buildProdImageBuildCommand,
  buildProdImageInspectCommand,
  buildProdRuntimeScript,
  buildSmokeStageBuildCommand,
  defaultRunner,
  isExpectedBootFailure,
  runSmoke,
} from "#scripts/smoke.ts";

describe("streambot smoke script", () => {
  test("builds --target smoke separately and omits Vitest test:integration from production container check", () => {
    expect(buildSmokeStageBuildCommand()).toEqual([
      "docker",
      "buildx",
      "build",
      "--target",
      "smoke",
      "--load",
      "-t",
      SMOKE_IMAGE,
      "-f",
      "Dockerfile",
      "../..",
    ]);

    const prodScript = buildProdRuntimeScript();
    expect(prodScript).not.toContain("test:integration");
    expect(prodScript).not.toContain("vitest");
    expect(prodScript).toContain("ffmpeg -version >/dev/null");
    expect(prodScript).toContain("/usr/local/bin/yt-dlp --version >/dev/null");
    expect(prodScript).toContain("bun run src/index.ts");

    const containerCmd = buildProdContainerRunCommand("smoke-streambot-42");
    expect(containerCmd).toContain(PROD_IMAGE);
    expect(containerCmd).toContain("USAGE_ANALYTICS_ENABLED=false");
  });

  test("recognizes expected Discord invalid-token boot errors", () => {
    expect(
      isExpectedBootFailure("Error [TokenInvalid]: An invalid token"),
    ).toBe(true);
    expect(isExpectedBootFailure("HTTP 401 Unauthorized")).toBe(true);
    expect(isExpectedBootFailure('Script not found "vitest"')).toBe(false);
  });

  test("runs --target smoke, reuses existing streambot:dev, and cleans up container", async () => {
    const calls: string[][] = [];
    const logs: string[] = [];

    await runSmoke({
      containerName: "smoke-streambot-test",
      packageDir: "/repo/packages/streambot",
      log: (msg) => logs.push(msg),
      runner: (cmd) => {
        calls.push(cmd);
        return Promise.resolve(
          cmd[0] === "docker" && cmd[1] === "run"
            ? {
                code: 1,
                stdout: "TokenInvalid: An invalid token was provided.",
              }
            : { code: 0, stdout: "" },
        );
      },
    });

    expect(calls).toEqual([
      ["docker", "rm", "-f", "smoke-streambot-test"],
      buildSmokeStageBuildCommand(),
      buildProdImageInspectCommand(),
      buildProdContainerRunCommand("smoke-streambot-test"),
      ["docker", "rm", "-f", "smoke-streambot-test"],
    ]);
    expect(logs).toHaveLength(1);
  });

  test("builds streambot:dev automatically when missing and cleans up on failure", async () => {
    const calls: string[][] = [];

    await expect(
      runSmoke({
        containerName: "smoke-streambot-missing",
        packageDir: "/repo/packages/streambot",
        runner: (cmd) => {
          calls.push(cmd);
          if (cmd[1] === "image" && cmd[2] === "inspect") {
            return Promise.resolve({ code: 1, stdout: "No such image" });
          }
          if (cmd[1] === "run") {
            return Promise.resolve({
              code: 1,
              stdout: "Cannot find module '@shepherdjerred/config'",
            });
          }
          return Promise.resolve({ code: 0, stdout: "" });
        },
      }),
    ).rejects.toThrow(/Smoke test failed/);

    expect(calls).toEqual([
      ["docker", "rm", "-f", "smoke-streambot-missing"],
      buildSmokeStageBuildCommand(),
      buildProdImageInspectCommand(),
      buildProdImageBuildCommand(),
      buildProdContainerRunCommand("smoke-streambot-missing"),
      ["docker", "rm", "-f", "smoke-streambot-missing"],
    ]);
  });

  test("fails immediately if --target smoke build fails and still cleans up container", async () => {
    const calls: string[][] = [];

    await expect(
      runSmoke({
        containerName: "smoke-streambot-build-fail",
        runner: (cmd) => {
          calls.push(cmd);
          return Promise.resolve(
            cmd[1] === "buildx"
              ? { code: 1, stdout: "integration failed" }
              : { code: 0, stdout: "" },
          );
        },
      }),
    ).rejects.toThrow(/Docker smoke stage build failed/);

    expect(calls).toEqual([
      ["docker", "rm", "-f", "smoke-streambot-build-fail"],
      buildSmokeStageBuildCommand(),
      ["docker", "rm", "-f", "smoke-streambot-build-fail"],
    ]);
  });

  test("fails if building missing streambot:dev fails, and defaultRunner captures output", async () => {
    await expect(
      runSmoke({
        containerName: "smoke-streambot-prod-build-fail",
        runner: (cmd) => {
          if (cmd[1] === "image" && cmd[2] === "inspect") {
            return Promise.resolve({ code: 1, stdout: "No such image" });
          }
          return Promise.resolve(
            cmd[1] === "buildx" && cmd.includes(PROD_IMAGE)
              ? { code: 1, stdout: "prod build error" }
              : { code: 0, stdout: "" },
          );
        },
      }),
    ).rejects.toThrow(/Docker production image build failed/);

    const res = await defaultRunner(["echo", "smoke-runner-ok"], {
      cwd: os.tmpdir(),
    });
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe("smoke-runner-ok");
  });
});
