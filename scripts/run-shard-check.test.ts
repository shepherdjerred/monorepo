import { describe, expect, test } from "vitest";
import {
  chunk,
  parseCheckName,
  parseTrackedEntry,
  runShardCheck,
  shardTrackedFiles,
} from "./run-shard-check.ts";

type RanCommand = string[];

function recordingRunner(ran: RanCommand[]) {
  return async (cmd: string[]) => {
    ran.push(cmd);
    return { stdout: "", stderr: "", exitCode: 0 };
  };
}

describe("parseCheckName", () => {
  test("accepts the sharded checks", () => {
    expect(parseCheckName("prettier")).toBe("prettier");
    expect(parseCheckName("line-endings")).toBe("line-endings");
    expect(parseCheckName("large-files")).toBe("large-files");
  });

  test("rejects unknown checks with the valid list", () => {
    expect(() => parseCheckName("gitleaks")).toThrow(/prettier/);
  });
});

describe("parseTrackedEntry", () => {
  test("splits mode and path on the tab", () => {
    expect(
      parseTrackedEntry(`100644 ${"a".repeat(40)} 0\tscripts/verify.ts`),
    ).toEqual({ mode: "100644", path: "scripts/verify.ts" });
  });

  test("returns null for tabless records", () => {
    expect(parseTrackedEntry("garbage")).toBeNull();
  });
});

describe("chunk", () => {
  test("splits into bounded pieces preserving order", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("returns nothing for an empty list", () => {
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("shardTrackedFiles", () => {
  test("resolves existing tracked files and never symlinks", async () => {
    const files = await shardTrackedFiles("root");
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("scripts/verify.ts");
    // CLAUDE.md is the repo's standing symlink (to AGENTS.md); prettier
    // errors on explicitly-passed symlinks, so it must be filtered here.
    expect(files).not.toContain("CLAUDE.md");
    for (const file of files) {
      expect(file.startsWith("packages/")).toBe(false);
    }
  });
});

describe("runShardCheck", () => {
  test("prettier runs chunked over the resolved shard files", async () => {
    const ran: RanCommand[] = [];
    const files = Array.from({ length: 1001 }, (_, i) => `file-${String(i)}`);
    await runShardCheck("prettier", "scout", {
      runner: recordingRunner(ran),
      fileResolver: async () => files,
    });
    expect(ran.length).toBe(2);
    const first = ran[0] ?? [];
    expect(first.slice(0, 5)).toEqual([
      "bunx",
      "--no-install",
      "prettier",
      "--check",
      "--ignore-unknown",
    ]);
    expect(first.length).toBe(5 + 1000);
    expect(ran[1]?.length).toBe(5 + 1);
  });

  test("prettier is a no-op for an empty shard", async () => {
    const ran: RanCommand[] = [];
    await runShardCheck("prettier", "scout", {
      runner: recordingRunner(ran),
      fileResolver: async () => [],
    });
    expect(ran).toEqual([]);
  });

  test("git-index checks receive the shard pathspecs verbatim", async () => {
    const ran: RanCommand[] = [];
    await runShardCheck("line-endings", "packages", {
      runner: recordingRunner(ran),
    });
    expect(ran).toEqual([
      [
        "bun",
        "--no-install",
        "scripts/check-line-endings.ts",
        "packages",
        ":(exclude)packages/scout-for-lol",
        ":(exclude)packages/homelab",
      ],
    ]);
  });

  test("large-files targets its own script", async () => {
    const ran: RanCommand[] = [];
    await runShardCheck("large-files", "homelab", {
      runner: recordingRunner(ran),
    });
    expect(ran).toEqual([
      [
        "bun",
        "--no-install",
        "scripts/check-large-files.ts",
        "packages/homelab",
      ],
    ]);
  });
});
