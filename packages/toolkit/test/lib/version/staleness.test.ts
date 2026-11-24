import { describe, expect, test } from "vitest";
import {
  TOOLKIT_BUILD_INPUT_PATHS,
  computeInputTreeDigest,
  formatToolkitVersion,
  type GitSyncRunner,
  type ToolkitBuildStamp,
  warnIfInstalledBinaryStale,
} from "#lib/version/staleness.ts";

const BASE_TREE = [
  "040000 tree 1111111111111111111111111111111111111111\tpackages/code-review",
  "040000 tree 2222222222222222222222222222222222222222\tpackages/toolkit",
].join("\n");

const UPDATED_TREE = [
  "040000 tree 1111111111111111111111111111111111111111\tpackages/code-review",
  "040000 tree 9999999999999999999999999999999999999999\tpackages/toolkit",
].join("\n");

const STAMP: ToolkitBuildStamp = {
  commit: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  inputDigest: computeInputTreeDigest(BASE_TREE),
  builtAt: "2026-11-08T23:19:00.000Z",
};

type FakeGitConfig = {
  readonly repoRoot?: string | null;
  readonly originMainSha?: string;
  readonly headSha?: string;
  readonly ancestors?: ReadonlySet<string>;
  readonly trees?: Readonly<Record<string, string>>;
};

function nonEmptyOut(value: string | undefined): {
  readonly exitCode: number;
  readonly stdout: string;
} {
  return value !== undefined && value.length > 0
    ? { exitCode: 0, stdout: `${value}\n` }
    : { exitCode: 1, stdout: "" };
}

function makeFakeGit(config: FakeGitConfig): GitSyncRunner {
  return (args) => {
    const sub = `${args[0] ?? ""}:${args[1] ?? ""}`;
    if (sub === "rev-parse:--show-toplevel") {
      return config.repoRoot === null
        ? { exitCode: 128, stdout: "" }
        : { exitCode: 0, stdout: `${config.repoRoot ?? "/monorepo"}\n` };
    }
    if (sub === "rev-parse:--verify") {
      const target = args[3] ?? "";
      return nonEmptyOut(
        target.startsWith("origin/main")
          ? config.originMainSha
          : config.headSha,
      );
    }
    if (sub === "merge-base:--is-ancestor") {
      const key = `${args[2] ?? ""}->${args[3] ?? ""}`;
      return { exitCode: config.ancestors?.has(key) ? 0 : 1, stdout: "" };
    }
    return args[0] === "ls-tree"
      ? nonEmptyOut(config.trees?.[args[1] ?? ""])
      : { exitCode: 1, stdout: "" };
  };
}

describe("formatToolkitVersion", () => {
  test("formats uncompiled and compiled versions accurately", () => {
    expect(formatToolkitVersion("0.1.0", null)).toBe("toolkit 0.1.0");
    expect(formatToolkitVersion("0.1.0", STAMP)).toBe(
      "toolkit 0.1.0 (a1b2c3d, built 2026-11-08T23:19:00.000Z)",
    );
    expect(TOOLKIT_BUILD_INPUT_PATHS).toHaveLength(10);
  });
});

describe("warnIfInstalledBinaryStale", () => {
  test("is a no-op when uncompiled, when TOOLKIT_NO_STALE_WARNING=1, or outside the monorepo", () => {
    const warnings: string[] = [];
    warnIfInstalledBinaryStale(
      {},
      { stamp: null, writeWarning: (line) => warnings.push(line) },
    );
    warnIfInstalledBinaryStale(
      { TOOLKIT_NO_STALE_WARNING: "1" },
      {
        stamp: STAMP,
        isMonorepoRoot: () => true,
        runGit: makeFakeGit({
          originMainSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          ancestors: new Set([`${STAMP.commit}->origin/main`]),
          trees: { "origin/main": UPDATED_TREE },
        }),
        writeWarning: (line) => warnings.push(line),
      },
    );
    warnIfInstalledBinaryStale(
      {},
      {
        stamp: STAMP,
        isMonorepoRoot: () => false,
        runGit: makeFakeGit({ repoRoot: "/other-repo" }),
        writeWarning: (line) => warnings.push(line),
      },
    );
    expect(warnings).toEqual([]);
  });

  test("stays silent when origin/main moved only in unrelated packages or when build is ahead of main", () => {
    const warnings: string[] = [];
    warnIfInstalledBinaryStale(
      {},
      {
        stamp: STAMP,
        isMonorepoRoot: () => true,
        runGit: makeFakeGit({
          originMainSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          ancestors: new Set([
            `${STAMP.commit}->origin/main`,
            `${STAMP.commit}->HEAD`,
          ]),
          trees: { "origin/main": BASE_TREE, HEAD: BASE_TREE },
        }),
        writeWarning: (line) => warnings.push(line),
      },
    );
    warnIfInstalledBinaryStale(
      {},
      {
        stamp: STAMP,
        isMonorepoRoot: () => true,
        runGit: makeFakeGit({
          originMainSha: "cccccccccccccccccccccccccccccccccccccccc",
          headSha: "cccccccccccccccccccccccccccccccccccccccc",
          ancestors: new Set(),
          trees: { "origin/main": UPDATED_TREE, HEAD: UPDATED_TREE },
        }),
        writeWarning: (line) => warnings.push(line),
      },
    );
    expect(warnings).toEqual([]);
  });

  test("warns once when lagging origin/main or HEAD with changed toolkit input trees", () => {
    const mainWarnings: string[] = [];
    warnIfInstalledBinaryStale(
      {},
      {
        stamp: STAMP,
        isMonorepoRoot: () => true,
        runGit: makeFakeGit({
          originMainSha: "dddddddddddddddddddddddddddddddddddddddd",
          headSha: "dddddddddddddddddddddddddddddddddddddddd",
          ancestors: new Set([
            `${STAMP.commit}->origin/main`,
            `${STAMP.commit}->HEAD`,
          ]),
          trees: { "origin/main": UPDATED_TREE, HEAD: UPDATED_TREE },
        }),
        writeWarning: (line) => mainWarnings.push(line),
      },
    );
    expect(mainWarnings).toEqual([
      "toolkit: warning: installed binary (a1b2c3d, built 2026-11-08) lags origin/main; run 'bun --cwd packages/toolkit run install:local'",
    ]);

    const headWarnings: string[] = [];
    warnIfInstalledBinaryStale(
      {},
      {
        stamp: STAMP,
        isMonorepoRoot: () => true,
        runGit: makeFakeGit({
          originMainSha: STAMP.commit,
          headSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          ancestors: new Set([`${STAMP.commit}->HEAD`]),
          trees: { "origin/main": BASE_TREE, HEAD: UPDATED_TREE },
        }),
        writeWarning: (line) => headWarnings.push(line),
      },
    );
    expect(headWarnings).toEqual([
      "toolkit: warning: installed binary (a1b2c3d, built 2026-11-08) lags HEAD; run 'bun --cwd packages/toolkit run install:local'",
    ]);
  });
});
