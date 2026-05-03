import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  detectChanges,
  _checkInfraChanges,
  _extractPackageName,
  _transitiveClosure,
  _isRenovatePr,
  _isVersionCommitBack,
  _isReleasePleaseMerge,
  _classifyRenovateFiles,
  _getBaseRevision,
  _getChangedFiles,
  _getLastGreenCommit,
  _NON_JS_PACKAGES,
  _JS_TS_PACKAGES,
} from "../change-detection.ts";
import { ALL_PACKAGES } from "../catalog.ts";

type ExecResult = { stdout: string; exitCode: number };
type ExecFn = (cmd: string[]) => Promise<ExecResult>;

function restoreEnv(originalEnv: NodeJS.ProcessEnv, keys: string[]): void {
  for (const key of keys) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("checkInfraChanges", () => {
  it("returns true for bun.lock changes", () => {
    expect(_checkInfraChanges(["bun.lock"])).toBe(true);
  });

  it("returns true for package.json changes", () => {
    expect(_checkInfraChanges(["package.json"])).toBe(true);
  });

  it("returns true for .buildkite/ changes", () => {
    expect(_checkInfraChanges([".buildkite/pipeline.yml"])).toBe(true);
  });

  it("returns true for .dagger/ changes", () => {
    expect(_checkInfraChanges([".dagger/src/index.ts"])).toBe(true);
  });

  it("returns true for scripts/ci/ changes", () => {
    expect(_checkInfraChanges(["scripts/ci/src/main.ts"])).toBe(true);
  });

  it("returns false for package-only changes", () => {
    expect(_checkInfraChanges(["packages/birmel/src/index.ts"])).toBe(false);
  });

  it("returns false for empty list", () => {
    expect(_checkInfraChanges([])).toBe(false);
  });
});

describe("extractPackageName", () => {
  it("extracts package name from packages/ path", () => {
    expect(_extractPackageName("packages/birmel/src/index.ts")).toBe("birmel");
  });

  it("extracts top-level package from nested paths", () => {
    expect(_extractPackageName("packages/homelab/src/cdk8s/main.ts")).toBe(
      "homelab",
    );
  });

  it("returns null for non-package paths", () => {
    expect(_extractPackageName("scripts/ci/src/main.ts")).toBeNull();
    expect(_extractPackageName(".buildkite/pipeline.yml")).toBeNull();
  });
});

describe("transitiveClosure", () => {
  it("includes directly changed packages", () => {
    const deps = new Map<string, Set<string>>();
    deps.set("a", new Set());
    deps.set("b", new Set());

    const result = _transitiveClosure(new Set(["a"]), deps);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(false);
  });

  it("includes packages that depend on changed packages", () => {
    const deps = new Map<string, Set<string>>();
    deps.set("a", new Set()); // a has no deps
    deps.set("b", new Set(["a"])); // b depends on a

    const result = _transitiveClosure(new Set(["a"]), deps);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(true);
  });

  it("follows transitive dependencies", () => {
    const deps = new Map<string, Set<string>>();
    deps.set("a", new Set()); // a has no deps
    deps.set("b", new Set(["a"])); // b depends on a
    deps.set("c", new Set(["b"])); // c depends on b

    const result = _transitiveClosure(new Set(["a"]), deps);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(true);
    expect(result.has("c")).toBe(true);
  });

  it("does not include unrelated packages", () => {
    const deps = new Map<string, Set<string>>();
    deps.set("a", new Set());
    deps.set("b", new Set(["a"]));
    deps.set("c", new Set());

    const result = _transitiveClosure(new Set(["a"]), deps);
    expect(result.has("c")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Renovate fast-track
// ---------------------------------------------------------------------------

describe("isRenovatePr", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env["BUILDKITE_BUILD_AUTHOR_EMAIL"];
    delete process.env["BUILDKITE_PULL_REQUEST"];
  });

  afterEach(() => {
    process.env["BUILDKITE_BUILD_AUTHOR_EMAIL"] =
      originalEnv["BUILDKITE_BUILD_AUTHOR_EMAIL"];
    process.env["BUILDKITE_PULL_REQUEST"] =
      originalEnv["BUILDKITE_PULL_REQUEST"];
  });

  it("returns true when email matches and PR is set", () => {
    process.env["BUILDKITE_BUILD_AUTHOR_EMAIL"] =
      "29139614+renovate[bot]@users.noreply.github.com";
    process.env["BUILDKITE_PULL_REQUEST"] = "42";
    expect(_isRenovatePr()).toBe(true);
  });

  it("returns false when email matches but PR is false", () => {
    process.env["BUILDKITE_BUILD_AUTHOR_EMAIL"] =
      "29139614+renovate[bot]@users.noreply.github.com";
    process.env["BUILDKITE_PULL_REQUEST"] = "false";
    expect(_isRenovatePr()).toBe(false);
  });

  it("returns false when PR is set but email is wrong", () => {
    process.env["BUILDKITE_BUILD_AUTHOR_EMAIL"] = "dev@example.com";
    process.env["BUILDKITE_PULL_REQUEST"] = "42";
    expect(_isRenovatePr()).toBe(false);
  });

  it("returns false when env vars are undefined", () => {
    expect(_isRenovatePr()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Version commit-back fast-track
// ---------------------------------------------------------------------------

describe("isVersionCommitBack", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env["BUILDKITE_MESSAGE"];
  });

  afterEach(() => {
    process.env["BUILDKITE_MESSAGE"] = originalEnv["BUILDKITE_MESSAGE"];
  });

  it("returns true for version bump commit message", () => {
    process.env["BUILDKITE_MESSAGE"] =
      "chore: bump image versions to 2.0.0-867";
    expect(_isVersionCommitBack()).toBe(true);
  });

  it("returns false for unrelated commit message", () => {
    process.env["BUILDKITE_MESSAGE"] = "feat: add new feature";
    expect(_isVersionCommitBack()).toBe(false);
  });

  it("returns false when env var is undefined", () => {
    expect(_isVersionCommitBack()).toBe(false);
  });

  it("returns false for partial match", () => {
    process.env["BUILDKITE_MESSAGE"] = "chore: bump image versions";
    expect(_isVersionCommitBack()).toBe(false);
  });

  it("returns false for similar but different message", () => {
    process.env["BUILDKITE_MESSAGE"] =
      "chore: bump chart versions to 2.0.0-867";
    expect(_isVersionCommitBack()).toBe(false);
  });

  it("matches real commit message format from versionCommitBackHelper", () => {
    // This is the exact format produced by .dagger/src/release.ts
    process.env["BUILDKITE_MESSAGE"] =
      "chore: bump image versions to 2.0.0-1234";
    expect(_isVersionCommitBack()).toBe(true);
  });
});

describe("isReleasePleaseMerge", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env["BUILDKITE_MESSAGE"];
  });

  afterEach(() => {
    process.env["BUILDKITE_MESSAGE"] = originalEnv["BUILDKITE_MESSAGE"];
  });

  it("returns true for release-please commit message", () => {
    process.env["BUILDKITE_MESSAGE"] = "chore: release main";
    expect(_isReleasePleaseMerge()).toBe(true);
  });

  it("returns false for unrelated commit message", () => {
    process.env["BUILDKITE_MESSAGE"] = "feat: add new feature";
    expect(_isReleasePleaseMerge()).toBe(false);
  });

  it("returns false when env var is undefined", () => {
    expect(_isReleasePleaseMerge()).toBe(false);
  });

  it("returns false for version bump commit message", () => {
    process.env["BUILDKITE_MESSAGE"] =
      "chore: bump image versions to 2.0.0-867";
    expect(_isReleasePleaseMerge()).toBe(false);
  });
});

describe("version commit-back + classifyRenovateFiles interaction", () => {
  it("versions.ts-only change classifies as noop (used by commit-back fast-track)", () => {
    // This is the exact file changed by version-commit-back
    const result = _classifyRenovateFiles([
      "packages/homelab/src/cdk8s/src/versions.ts",
    ]);
    expect(result).toEqual({ kind: "noop" });
  });

  it("versions.ts + bun.lock classifies as noop", () => {
    const result = _classifyRenovateFiles([
      "packages/homelab/src/cdk8s/src/versions.ts",
      "bun.lock",
    ]);
    expect(result).toEqual({ kind: "noop" });
  });

  it("versions.ts + unexpected source file classifies as null (falls through)", () => {
    const result = _classifyRenovateFiles([
      "packages/homelab/src/cdk8s/src/versions.ts",
      "packages/homelab/src/cdk8s/src/main.ts",
    ]);
    expect(result).toBeNull();
  });
});

describe("classifyRenovateFiles", () => {
  // noop cases
  it("returns noop for versions.ts only", () => {
    expect(
      _classifyRenovateFiles(["packages/homelab/src/cdk8s/src/versions.ts"]),
    ).toEqual({ kind: "noop" });
  });

  it("returns noop for lib-versions.ts", () => {
    expect(
      _classifyRenovateFiles(["packages/homelab/src/lib-versions.ts"]),
    ).toEqual({ kind: "noop" });
  });

  it("returns noop for .buildkite/scripts/setup-tools.sh", () => {
    expect(
      _classifyRenovateFiles([".buildkite/scripts/setup-tools.sh"]),
    ).toEqual({ kind: "noop" });
  });

  it("returns noop for .buildkite/ci-image/ files", () => {
    expect(_classifyRenovateFiles([".buildkite/ci-image/Dockerfile"])).toEqual({
      kind: "noop",
    });
  });

  it("returns noop for root bun.lock alone", () => {
    expect(_classifyRenovateFiles(["bun.lock"])).toEqual({ kind: "noop" });
  });

  it("returns noop for empty file list", () => {
    expect(_classifyRenovateFiles([])).toEqual({ kind: "noop" });
  });

  // scoped cases
  it("returns scoped for single package.json + bun.lock", () => {
    const result = _classifyRenovateFiles([
      "packages/birmel/package.json",
      "packages/birmel/bun.lock",
    ]);
    expect(result).toEqual({
      kind: "scoped",
      packages: new Set(["birmel"]),
    });
  });

  it("returns scoped for package-lock.json", () => {
    const result = _classifyRenovateFiles([
      "packages/birmel/package-lock.json",
    ]);
    expect(result).toEqual({
      kind: "scoped",
      packages: new Set(["birmel"]),
    });
  });

  it("returns scoped for Dockerfile", () => {
    const result = _classifyRenovateFiles([
      "packages/starlight-karma-bot/Dockerfile",
    ]);
    expect(result).toEqual({
      kind: "scoped",
      packages: new Set(["starlight-karma-bot"]),
    });
  });

  it("returns scoped for multiple packages", () => {
    const result = _classifyRenovateFiles([
      "packages/birmel/package.json",
      "packages/scout-for-lol/package.json",
      "bun.lock",
    ]);
    expect(result).toEqual({
      kind: "scoped",
      packages: new Set(["birmel", "scout-for-lol"]),
    });
  });

  // root package.json — noop (only contains markdownlint-cli2, no workspace-consumed deps)
  it("returns noop for root package.json", () => {
    expect(_classifyRenovateFiles(["package.json", "bun.lock"])).toEqual({
      kind: "noop",
    });
  });

  // .dagger manifest/lockfile — noop (Dagger runtime tool versions, not workspace code)
  it("returns noop for .dagger/package.json", () => {
    expect(_classifyRenovateFiles([".dagger/package.json"])).toEqual({
      kind: "noop",
    });
  });

  it("returns noop for .dagger/bun.lock", () => {
    expect(_classifyRenovateFiles([".dagger/bun.lock"])).toEqual({
      kind: "noop",
    });
  });

  it("returns noop for .dagger/package-lock.json", () => {
    expect(_classifyRenovateFiles([".dagger/package-lock.json"])).toEqual({
      kind: "noop",
    });
  });

  // null (fallthrough) cases

  it("returns null for unknown file", () => {
    expect(_classifyRenovateFiles(["some/random/file.ts"])).toBeNull();
  });

  it("returns null for unknown file under packages/", () => {
    expect(_classifyRenovateFiles(["packages/birmel/src/index.ts"])).toBeNull();
  });

  // priority tests
  it("scoped wins over noop when mixed", () => {
    const result = _classifyRenovateFiles([
      "packages/homelab/src/cdk8s/src/versions.ts",
      "packages/birmel/package.json",
    ]);
    expect(result).toEqual({
      kind: "scoped",
      packages: new Set(["birmel"]),
    });
  });

  it("scoped wins over noop when root package.json is present", () => {
    // root package.json is noop, so scoped (packages/birmel/package.json) wins
    const result = _classifyRenovateFiles([
      "packages/birmel/package.json",
      "package.json",
      "bun.lock",
    ]);
    expect(result).toEqual({
      kind: "scoped",
      packages: new Set(["birmel"]),
    });
  });

  it("null wins over noop when an unrecognized file is present", () => {
    expect(
      _classifyRenovateFiles([
        "packages/homelab/src/cdk8s/src/versions.ts",
        "some/unrecognized/file.ts",
      ]),
    ).toBeNull();
  });
});

describe("fail-fast base detection", () => {
  const originalEnv = { ...process.env };
  const envKeys = [
    "BUILDKITE_API_TOKEN",
    "BUILDKITE_AGENT_ACCESS_TOKEN",
    "BUILDKITE_ORGANIZATION_SLUG",
    "BUILDKITE_PIPELINE_SLUG",
    "BUILDKITE_BUILD_NUMBER",
    "BUILDKITE_BRANCH",
    "BUILDKITE_PULL_REQUEST",
    "BUILDKITE_MESSAGE",
    "FULL_BUILD",
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      delete process.env[key];
    }
    process.env["BUILDKITE_ORGANIZATION_SLUG"] = "sjerred";
    process.env["BUILDKITE_PIPELINE_SLUG"] = "monorepo";
    process.env["BUILDKITE_BUILD_NUMBER"] = "100";
  });

  afterEach(() => {
    restoreEnv(originalEnv, envKeys);
  });

  it("requires BUILDKITE_API_TOKEN for main-branch Buildkite API detection", async () => {
    await expect(_getLastGreenCommit()).rejects.toThrow(
      "BUILDKITE_API_TOKEN is required",
    );
  });

  it("does not use BUILDKITE_AGENT_ACCESS_TOKEN as a REST API fallback", async () => {
    process.env["BUILDKITE_AGENT_ACCESS_TOKEN"] = "agent-token";
    const fetchFn = async () => {
      throw new Error("fetch should not be called");
    };

    await expect(_getLastGreenCommit(fetchFn)).rejects.toThrow(
      "BUILDKITE_API_TOKEN is required",
    );
  });

  it("rejects unauthorized Buildkite API responses with scope guidance", async () => {
    process.env["BUILDKITE_API_TOKEN"] = "api-token";
    const fetchFn = async () => new Response("", { status: 401 });

    await expect(_getLastGreenCommit(fetchFn)).rejects.toThrow(
      "read_builds scope",
    );
  });

  it("rejects non-OK Buildkite API responses", async () => {
    process.env["BUILDKITE_API_TOKEN"] = "api-token";
    const fetchFn = async () => new Response("", { status: 500 });

    await expect(_getLastGreenCommit(fetchFn)).rejects.toThrow("HTTP 500");
  });

  it("rejects Buildkite API request failures", async () => {
    process.env["BUILDKITE_API_TOKEN"] = "api-token";
    const fetchFn = async () => {
      throw new Error("timeout");
    };

    await expect(_getLastGreenCommit(fetchFn)).rejects.toThrow(
      "Buildkite API request failed: timeout",
    );
  });

  it("rejects when no qualifying green main build exists", async () => {
    process.env["BUILDKITE_API_TOKEN"] = "api-token";
    const fetchFn = async () =>
      new Response(
        JSON.stringify([
          {
            number: 99,
            commit: "abc123",
            jobs: [{ name: ":eslint: Lint" }],
          },
        ]),
        { status: 200 },
      );

    await expect(_getLastGreenCommit(fetchFn)).rejects.toThrow(
      "No qualifying green main build found",
    );
  });

  it("returns the first qualifying previous green build commit", async () => {
    process.env["BUILDKITE_API_TOKEN"] = "api-token";
    const fetchFn = async () =>
      new Response(
        JSON.stringify([
          {
            number: 100,
            commit: "current",
            jobs: [{ name: ":test_tube: Test" }],
          },
          {
            number: 99,
            commit: "abc123def456",
            jobs: [{ name: ":test_tube: Test" }],
          },
        ]),
        { status: 200 },
      );

    await expect(_getLastGreenCommit(fetchFn)).resolves.toBe("abc123def456");
  });

  it("rejects when merge-base cannot be computed", async () => {
    process.env["BUILDKITE_BRANCH"] = "feature";
    process.env["BUILDKITE_PULL_REQUEST"] = "42";
    const execFn: ExecFn = async () => ({ stdout: "", exitCode: 1 });

    await expect(_getBaseRevision(execFn)).rejects.toThrow(
      "Unable to compute merge-base",
    );
  });

  it("rejects when git diff fails after resolving a base", async () => {
    process.env["BUILDKITE_BRANCH"] = "feature";
    process.env["BUILDKITE_PULL_REQUEST"] = "false";
    const execFn: ExecFn = async (cmd) => {
      if (cmd[1] === "merge-base") {
        return { stdout: "abc123", exitCode: 0 };
      }
      return { stdout: "", exitCode: 1 };
    };

    await expect(_getChangedFiles(execFn)).rejects.toThrow(
      "Unable to diff base revision abc123 against HEAD",
    );
  });

  it("returns a full build when explicitly requested without checking Buildkite API", async () => {
    process.env["BUILDKITE_BRANCH"] = "main";
    process.env["FULL_BUILD"] = "true";

    const result = await detectChanges();

    expect(result.buildAll).toBe(true);
    expect(result.packages.size).toBe(ALL_PACKAGES.length);
  });
});

describe("NON_JS_PACKAGES and JS_TS_PACKAGES", () => {
  it("NON_JS_PACKAGES contains exactly the non-JS packages", () => {
    expect(_NON_JS_PACKAGES).toEqual(
      new Set([
        "castle-casters",
        "clauderon",
        "terraform-provider-asuswrt",
        "resume",
      ]),
    );
  });

  it("JS_TS_PACKAGES excludes non-JS packages", () => {
    for (const pkg of _NON_JS_PACKAGES) {
      expect(_JS_TS_PACKAGES).not.toContain(pkg);
    }
  });

  it("JS_TS_PACKAGES + NON_JS_PACKAGES = ALL_PACKAGES", () => {
    const combined = [..._JS_TS_PACKAGES, ..._NON_JS_PACKAGES].sort();
    expect(combined).toEqual([...ALL_PACKAGES].sort());
  });
});
