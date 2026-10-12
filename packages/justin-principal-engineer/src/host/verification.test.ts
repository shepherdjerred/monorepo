import { describe, expect, test } from "vitest";
import { verificationCommand } from "#src/host/verification.ts";
import type { CommandRunner } from "#src/runtime/process.ts";

function fixture() {
  const commands: string[][] = [];
  const run: CommandRunner = async (args) => {
    commands.push([...args]);
    const data =
      args[2] === "origin/main:package.json"
        ? {
            workspaces: [
              "packages/outer",
              "packages/outer/packages/inner",
              "scripts",
            ],
          }
        : {
            name:
              args[2]?.includes("/inner/") === true
                ? "@owner/inner"
                : "@owner/outer",
          };
    return {
      exitCode: 0,
      stdout: JSON.stringify(data),
      stderr: "",
      timedOut: false,
    };
  };
  return { run, commands };
}
describe("host verification scope", () => {
  test("uses the closest declared workspace and manifests from the base revision", async () => {
    const { run, commands } = fixture();
    const command = await verificationCommand({
      checkout: "/tmp/task",
      baseBranch: "main",
      paths: [
        "packages/outer/packages/inner/src/a.ts",
        "packages/outer/packages/inner/test/a.test.ts",
      ],
      run,
    });
    expect(command.slice(-1)).toEqual(["--filter=@owner/inner"]);
    expect(commands).toEqual([
      ["git", "show", "origin/main:package.json"],
      ["git", "show", "origin/main:packages/outer/packages/inner/package.json"],
    ]);
  });
  test("checks all touched packages and ignores undeclared fixture manifests", async () => {
    const { run } = fixture();
    const command = await verificationCommand({
      checkout: "/tmp/task",
      baseBranch: "main",
      paths: [
        "packages/outer/test/fixtures/package.json",
        "packages/outer/packages/inner/src/a.ts",
      ],
      run,
    });
    expect(command).toContain("--filter=@owner/inner");
    expect(command).toContain("--filter=@owner/outer");
  });
  test("uses the repository gate for root changes or new workspaces", async () => {
    const { run } = fixture();
    for (const file of ["bun.lock", "packages/new-package/package.json"]) {
      await expect(
        verificationCommand({
          checkout: "/tmp/task",
          baseBranch: "main",
          paths: [file],
          run,
        }),
      ).resolves.toEqual(["bun", "run", "verify"]);
    }
  });
});
