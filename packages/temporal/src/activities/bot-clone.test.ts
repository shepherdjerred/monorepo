import { describe, expect, test } from "bun:test";
import {
  installScoutWorkspace,
  type BotCloneCommandRunner,
} from "./bot-clone.ts";

const REPO_DIR = "/tmp/scout-refresh-test/monorepo";
const CACHE_DIR = `${REPO_DIR}/../bun-install-cache`;

type RecordedCommand = {
  command: string[];
  options: Parameters<BotCloneCommandRunner>[1];
};

describe("installScoutWorkspace", () => {
  test("owns one hook-free root install followed by both Scout producers", async () => {
    const calls: RecordedCommand[] = [];
    const commandRunner: BotCloneCommandRunner = (command, options) => {
      calls.push({ command, options });
      return Promise.resolve("");
    };

    await installScoutWorkspace(REPO_DIR, commandRunner);

    expect(calls).toEqual([
      {
        command: ["bun", "install", "--frozen-lockfile", "--ignore-scripts"],
        options: {
          cwd: REPO_DIR,
          env: { BUN_INSTALL_CACHE_DIR: CACHE_DIR },
        },
      },
      {
        command: ["bun", "run", "build"],
        options: {
          cwd: `${REPO_DIR}/packages/llm-models`,
          env: { BUN_INSTALL_CACHE_DIR: CACHE_DIR },
        },
      },
      {
        command: ["bun", "run", "build"],
        options: {
          cwd: `${REPO_DIR}/packages/glitter-context`,
          env: { BUN_INSTALL_CACHE_DIR: CACHE_DIR },
        },
      },
    ]);
  });
});

describe("Scout activity setup ownership", () => {
  for (const filename of [
    "scout-queue-windows.ts",
    "scout-showcase-refresh.ts",
  ]) {
    test(`${filename} delegates its only install to installScoutWorkspace`, async () => {
      const source = await Bun.file(`${import.meta.dir}/${filename}`).text();
      const rootInstallReferences =
        source.match(/\brootInstallWithoutHooks\b/g) ?? [];
      const scoutInstallCalls =
        source.match(/\binstallScoutWorkspace\(repoDir\)/g) ?? [];

      expect(rootInstallReferences).toHaveLength(0);
      expect(scoutInstallCalls).toHaveLength(1);
    });
  }
});
