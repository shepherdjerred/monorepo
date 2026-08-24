import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  discardFormattingOnlyChanges,
  generatedTextPaths,
  runScoutGeneratedPreflight,
} from "./scout-generated-preflight.ts";
import { runCommand as shellRunCommand } from "./data-dragon-shell.ts";

describe("generatedTextPaths", () => {
  test("selects and sorts formatter-supported generated files", () => {
    expect(
      generatedTextPaths([
        "packages/data/image.png",
        "packages/data/z.json",
        "packages/data/a.ts",
        "packages/data/raw.html",
        "packages/data/schema.yaml",
        "packages/data/styles.css",
        "packages/data/raw.txt",
        "packages/scout-for-lol/packages/data/patch-notes-archive/raw.html",
        "packages/scout-for-lol/packages/data/src/__snapshots__/data.snap",
      ]),
    ).toEqual([
      "packages/data/a.ts",
      "packages/data/raw.html",
      "packages/data/schema.yaml",
      "packages/data/styles.css",
      "packages/data/z.json",
    ]);
  });
});

describe("discardFormattingOnlyChanges", () => {
  const temporaryDirectories: string[] = [];
  const workspaceRoot = nodePath.resolve(import.meta.dir, "../../../..");

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function createRepository(initialContent: string): Promise<string> {
    const repoDir = await mkdtemp(`${tmpdir()}/scout-format-guard-`);
    temporaryDirectories.push(repoDir);
    await shellRunCommand(["git", "init", "-q"], { cwd: repoDir });
    await shellRunCommand(["git", "config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await shellRunCommand(["git", "config", "user.name", "Test"], {
      cwd: repoDir,
    });
    await Bun.write(`${repoDir}/item.ts`, initialContent);
    await shellRunCommand(["git", "add", "item.ts"], { cwd: repoDir });
    await shellRunCommand(["git", "commit", "-qm", "baseline"], {
      cwd: repoDir,
    });
    return repoDir;
  }

  function commandRunner(repoDir: string): typeof shellRunCommand {
    return async (command, options) => {
      if (command[0] !== "bunx") {
        return await shellRunCommand(command, options);
      }
      const separator = command.indexOf("--");
      const absoluteCommand = command.map((part, index) =>
        index > separator && !part.startsWith("/")
          ? `${repoDir}/${part}`
          : part,
      );
      return await shellRunCommand(absoluteCommand, {
        ...options,
        cwd: workspaceRoot,
      });
    };
  }

  test("restores the exact formatting-only union change from PR #2434", async () => {
    const repoDir = await createRepository(
      [
        "export type ItemBattleUse =",
        '  | "unavailable"',
        '  | "direct"',
        '  | "escape"',
        '  | "party"',
        '  | "move"',
        '  | "poke-ball";',
        "",
      ].join("\n"),
    );
    await Bun.write(
      `${repoDir}/item.ts`,
      [
        "export type ItemBattleUse =",
        '  "unavailable" | "direct" | "escape" | "party" | "move" | "poke-ball";',
        "",
      ].join("\n"),
    );

    const reverted = await discardFormattingOnlyChanges({
      repoDir,
      changedFiles: ["item.ts"],
      runCommand: commandRunner(repoDir),
    });

    expect(reverted).toEqual(["item.ts"]);
    expect(
      await shellRunCommand(["git", "status", "--porcelain", "--", "item.ts"], {
        cwd: repoDir,
        trimStdout: false,
      }),
    ).toBe("");
    expect(
      await shellRunCommand(["git", "status", "--porcelain"], {
        cwd: repoDir,
        trimStdout: false,
      }),
    ).toBe("");
  });

  test("keeps a generated semantic change after normalization", async () => {
    const repoDir = await createRepository(
      [
        "export type ItemBattleUse =",
        '  | "unavailable"',
        '  | "direct"',
        '  | "escape"',
        '  | "party"',
        '  | "move"',
        '  | "poke-ball";',
        "",
      ].join("\n"),
    );
    await Bun.write(
      `${repoDir}/item.ts`,
      [
        "export type ItemBattleUse =",
        '  | "unavailable"',
        '  | "direct"',
        '  | "escape"',
        '  | "party"',
        '  | "move"',
        '  | "great-ball";',
        "",
      ].join("\n"),
    );

    const reverted = await discardFormattingOnlyChanges({
      repoDir,
      changedFiles: ["item.ts"],
      runCommand: commandRunner(repoDir),
    });

    expect(reverted).toEqual([]);
    expect(
      await shellRunCommand(["git", "status", "--porcelain", "--", "item.ts"], {
        cwd: repoDir,
        trimStdout: false,
      }),
    ).toContain("item.ts");
  });

  test("does not suppress a new generated text file", async () => {
    const repoDir = await createRepository("export const baseline = true;\n");
    await Bun.write(`${repoDir}/new.ts`, "export   const generated = true;\n");

    const reverted = await discardFormattingOnlyChanges({
      repoDir,
      changedFiles: ["new.ts"],
      runCommand: commandRunner(repoDir),
    });

    expect(reverted).toEqual([]);
    expect(
      await shellRunCommand(["git", "status", "--porcelain", "--", "new.ts"], {
        cwd: repoDir,
        trimStdout: false,
      }),
    ).toContain("new.ts");
  });

  test("does not suppress a deleted generated file", async () => {
    const repoDir = await createRepository("export const baseline = true;\n");
    await shellRunCommand(["rm", "item.ts"], { cwd: repoDir });

    const reverted = await discardFormattingOnlyChanges({
      repoDir,
      changedFiles: ["item.ts"],
      runCommand: commandRunner(repoDir),
    });

    expect(reverted).toEqual([]);
    expect(
      await shellRunCommand(["git", "status", "--porcelain", "--", "item.ts"], {
        cwd: repoDir,
        trimStdout: false,
      }),
    ).toContain("item.ts");
  });

  test("does not suppress binary or unsupported files", async () => {
    const repoDir = await createRepository("export const baseline = true;\n");
    await Bun.write(`${repoDir}/asset.bin`, new Uint8Array([0, 1, 2]));
    await Bun.write(`${repoDir}/notes.txt`, "generated\n");

    const reverted = await discardFormattingOnlyChanges({
      repoDir,
      changedFiles: ["asset.bin", "notes.txt"],
      runCommand: commandRunner(repoDir),
    });

    expect(reverted).toEqual([]);
    expect(
      await shellRunCommand(
        ["git", "status", "--porcelain", "--", "asset.bin", "notes.txt"],
        { cwd: repoDir, trimStdout: false },
      ),
    ).toContain("?? asset.bin");
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
