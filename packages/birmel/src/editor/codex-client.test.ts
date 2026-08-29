import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  changesFromGitDiff,
  pathsOutsideAllowed,
  threadSelection,
} from "./codex-client.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function git(directory: string, ...args: string[]): Promise<void> {
  const process = Bun.spawn(["git", ...args], {
    cwd: directory,
    stdout: "ignore",
    stderr: "pipe",
  });
  if ((await process.exited) !== 0) {
    throw new Error(`git ${args[0] ?? "command"} failed`);
  }
}

async function repository(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "birmel-editor-"));
  directories.push(directory);
  await git(directory, "init");
  await git(directory, "config", "user.name", "Editor Test");
  await git(directory, "config", "user.email", "editor@example.com");
  await Bun.write(path.join(directory, "allowed.txt"), "before\n");
  await git(directory, "add", "allowed.txt");
  await git(directory, "commit", "-m", "fixture");
  return directory;
}

describe("Codex editor", () => {
  test("resumes a persisted Codex thread ID", () => {
    expect(threadSelection(undefined)).toEqual({ kind: "start" });
    expect(threadSelection("codex:thread-123")).toEqual({
      kind: "resume",
      id: "thread-123",
    });
    expect(threadSelection("legacy-claude-session")).toEqual({ kind: "start" });
  });

  test("uses the immutable baseline when the agent commits changes", async () => {
    const directory = await repository();
    const process = Bun.spawn(["git", "rev-parse", "HEAD"], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const baseline = (await new Response(process.stdout).text()).trim();
    if ((await process.exited) !== 0) throw new Error("git rev-parse failed");
    await Bun.write(path.join(directory, "allowed.txt"), "committed\n");
    await git(directory, "add", "allowed.txt");
    await git(directory, "commit", "-m", "agent edit");

    expect(await changesFromGitDiff(directory, ["*.txt"], baseline)).toEqual([
      {
        filePath: "allowed.txt",
        oldContent: "before\n",
        newContent: "committed\n",
        changeType: "modify",
      },
    ]);
  });

  test("derives created and modified files from the resulting Git diff", async () => {
    const directory = await repository();
    await Bun.write(path.join(directory, "allowed.txt"), "after\n");
    await Bun.write(path.join(directory, "created.txt"), "new\n");

    expect(await changesFromGitDiff(directory, ["*.txt"])).toEqual([
      {
        filePath: "allowed.txt",
        oldContent: "before\n",
        newContent: "after\n",
        changeType: "modify",
      },
      {
        filePath: "created.txt",
        oldContent: null,
        newContent: "new\n",
        changeType: "create",
      },
    ]);
  });

  test("rejects any resulting change outside allowedPaths", async () => {
    const directory = await repository();
    await Bun.write(path.join(directory, "blocked.md"), "blocked\n");

    await expect(changesFromGitDiff(directory, ["src/**"])).rejects.toThrow(
      "blocked.md",
    );
    expect(pathsOutsideAllowed(["src/index.ts"], ["src/**"])).toEqual([]);
  });

  test("rejects the source of a rename into an allowed path", async () => {
    const directory = await repository();
    await Bun.write(path.join(directory, "outside.txt"), "outside\n");
    await git(directory, "add", "outside.txt");
    await git(directory, "commit", "-m", "outside fixture");
    await git(directory, "mv", "outside.txt", "allowed-new.txt");

    await expect(
      changesFromGitDiff(directory, ["allowed-new.txt"]),
    ).rejects.toThrow("outside.txt");
  });
});
