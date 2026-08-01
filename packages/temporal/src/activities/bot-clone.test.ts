import { describe, expect, test } from "bun:test";
import {
  installScoutWorkspace,
  isTransientInstallError,
  withInstallRetry,
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

describe("isTransientInstallError", () => {
  test("matches a tarball extraction failure", () => {
    expect(
      isTransientInstallError(
        new Error(
          'Fail extracting tarball for "@react-native-async-storage/async-storage"',
        ),
      ),
    ).toBe(true);
  });

  test("matches ECONNRESET", () => {
    expect(isTransientInstallError(new Error("read ECONNRESET"))).toBe(true);
  });

  test("does not match a lockfile mismatch", () => {
    expect(
      isTransientInstallError(
        new Error("Frozen lockfile requires all dependencies be in lockfile"),
      ),
    ).toBe(false);
  });
});

describe("withInstallRetry", () => {
  test("retries a transient failure and eventually succeeds", async () => {
    let calls = 0;
    await withInstallRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error("ECONNRESET");
        }
        await Promise.resolve();
      },
      3,
      0,
    );

    expect(calls).toBe(3);
  });

  test("throws immediately on a non-transient failure without retrying", async () => {
    let calls = 0;
    await expect(
      withInstallRetry(
        async () => {
          calls += 1;
          await Promise.resolve();
          throw new Error("lockfile is out of date");
        },
        3,
        0,
      ),
    ).rejects.toThrow("lockfile is out of date");

    expect(calls).toBe(1);
  });

  test("throws after exhausting all attempts on a persistent transient failure", async () => {
    let calls = 0;
    await expect(
      withInstallRetry(
        async () => {
          calls += 1;
          await Promise.resolve();
          throw new Error("ETIMEDOUT");
        },
        3,
        0,
      ),
    ).rejects.toThrow("ETIMEDOUT");

    expect(calls).toBe(3);
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
