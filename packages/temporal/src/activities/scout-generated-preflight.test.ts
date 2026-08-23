import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import {
  generatedTextPaths,
  runScoutGeneratedPreflight,
} from "./scout-generated-preflight.ts";

describe("generatedTextPaths", () => {
  test("selects and sorts formatter-supported generated files", () => {
    expect(
      generatedTextPaths([
        "packages/data/image.png",
        "packages/data/z.json",
        "packages/data/a.ts",
        "packages/data/raw.html",
      ]),
    ).toEqual(["packages/data/a.ts", "packages/data/z.json"]);
  });
});

describe("runScoutGeneratedPreflight", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  test("formats, checks, and validates before publication", async () => {
    const calls: string[][] = [];
    const repoDir = await mkdtemp(`${tmpdir()}/scout-preflight-`);
    temporaryDirectories.push(repoDir);
    await Bun.write(`${repoDir}/packages/data/generated.json`, "{}\n");

    await runScoutGeneratedPreflight({
      repoDir,
      changedFiles: ["packages/data/generated.json", "assets/icon.png"],
      runCommand: async (command) => {
        calls.push(command);
        return "";
      },
    });

    expect(calls).toEqual([
      [
        "bunx",
        "--no-install",
        "prettier",
        "--write",
        "--ignore-unknown",
        "--",
        "packages/data/generated.json",
      ],
      [
        "bunx",
        "--no-install",
        "prettier",
        "--check",
        "--ignore-unknown",
        "--",
        "packages/data/generated.json",
      ],
      ["git", "diff", "--check"],
      [
        "bunx",
        "--no-install",
        "turbo",
        "run",
        "typecheck",
        "--filter=@scout-for-lol/design-system",
      ],
      [
        "bunx",
        "--no-install",
        "turbo",
        "run",
        "test",
        "--filter=@scout-for-lol/data",
      ],
    ]);
  });

  test("stops before later checks when formatting fails", async () => {
    const calls: string[][] = [];
    const repoDir = await mkdtemp(`${tmpdir()}/scout-preflight-`);
    temporaryDirectories.push(repoDir);
    await Bun.write(`${repoDir}/packages/data/generated.json`, "{}\n");

    await expect(
      runScoutGeneratedPreflight({
        repoDir,
        changedFiles: ["packages/data/generated.json"],
        runCommand: async (command) => {
          calls.push(command);
          throw new Error("prettier failed");
        },
      }),
    ).rejects.toThrow("prettier failed");

    expect(calls).toHaveLength(1);
  });

  test("stops before focused validation when git diff check fails", async () => {
    const calls: string[][] = [];
    const repoDir = await mkdtemp(`${tmpdir()}/scout-preflight-`);
    temporaryDirectories.push(repoDir);
    await Bun.write(`${repoDir}/packages/data/generated.json`, "{}\n");

    await expect(
      runScoutGeneratedPreflight({
        repoDir,
        changedFiles: ["packages/data/generated.json"],
        runCommand: async (command) => {
          calls.push(command);
          if (command[0] === "git") throw new Error("diff check failed");
          return "";
        },
      }),
    ).rejects.toThrow("diff check failed");

    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual(["git", "diff", "--check"]);
  });
});
