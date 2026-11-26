import { describe, expect, test, vi } from "vitest";
import {
  isRenovateUpdateEligible,
  type RankedRenovateUpdate,
  type RenovateTarget,
} from "@shepherdjerred/ops-model/renovate-ranking.ts";
import { createScratchWorkspace } from "#activities/remediation/codex-pr-remediation-git.ts";
import { runCommand } from "#activities/scout/scout-season-refresh-git.ts";
import { actualPinFile, expectedPinFile } from "./bundle-pins.ts";
import { canBundleTogether, targetArtifactPaths } from "./bundle-policy.ts";
import { sandboxBundleVerification } from "./bundle-sandbox.ts";
import { missingVerification, readBundleDiff } from "./bundle-verify.ts";
import {
  executeRenovateBundle,
  type VerifiedRenovateBundle,
} from "./bundle.ts";

const samplePath = "packages/sample/package.json";
const baseManifest = {
  name: "sample",
  scripts: { test: "bun test" },
  dependencies: { first: "^1.0.0", second: "^1.0.0" },
};

function target(packageName = "first"): RenovateTarget {
  return {
    manager: "npm",
    packageName,
    datasource: "npm",
    filePath: samplePath,
    currentValue: "^1.0.0",
    targetValue: "^2.0.0",
    currentVersion: "1.0.0",
    targetVersion: "2.0.0",
    currentDigest: null,
    digest: null,
  };
}

function candidate(id = "first", pin = target(id)): RankedRenovateUpdate {
  return {
    id,
    name: id,
    ecosystem: "npm",
    urgency: "medium",
    effort: "s",
    needed: true,
    rationale: "Compatible major update used by sample.",
    evidenceUrls: [],
    bake: {
      state: "ready",
      eligibleAt: "2026-08-01T00:00:00.000Z",
      reason: "Aged",
    },
    blockers: [],
    targets: [pin],
  };
}

function sandboxRepo() {
  const verification: string[] = [];
  return {
    verification,
    deps: {
      which: () => "tool-present",
      now: () => Date.parse("2026-08-02T00:00:00.000Z"),
      cloneRepo: async (repoDir: string) => {
        await Bun.write(
          `${repoDir}/${samplePath}`,
          JSON.stringify(baseManifest),
          { createPath: true },
        );
        await Bun.write(`${repoDir}/bun.lock`, "base-lock\n");
        await runCommand(["git", "init", "--initial-branch=main"], {
          cwd: repoDir,
        });
        await runCommand(["git", "add", "--", samplePath, "bun.lock"], {
          cwd: repoDir,
        });
        await runCommand(
          [
            "git",
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--no-verify",
            "-m",
            "fixture",
          ],
          { cwd: repoDir },
        );
      },
      commandRunner: (
        command: string[],
        options: Parameters<typeof runCommand>[1],
      ) => {
        if (command[0] === "git") return runCommand(command, options);
        verification.push(command.join(" "));
        return Promise.resolve("");
      },
    },
  };
}

async function editPins(
  repoDir: string,
  included: readonly string[],
): Promise<string> {
  const dependencies = {
    ...baseManifest.dependencies,
    ...Object.fromEntries(included.map((name) => [name, "^2.0.0"])),
  };
  await Bun.write(
    `${repoDir}/${samplePath}`,
    JSON.stringify({ ...baseManifest, dependencies }),
  );
  await Bun.write(`${repoDir}/bun.lock`, "verified-lock\n");
  return JSON.stringify({ included, oversized: [] });
}

describe("Renovate exact bundle pins", () => {
  test("allows small majors after their bake date and rejects a premature ready claim", () => {
    const update = candidate();
    expect(
      isRenovateUpdateEligible(update, Date.parse("2026-07-31T23:59:59.999Z")),
    ).toBe(false);
    expect(
      isRenovateUpdateEligible(update, Date.parse("2026-08-01T00:00:00.000Z")),
    ).toBe(true);
    expect(
      isRenovateUpdateEligible(
        { ...update, effort: "l" },
        Date.parse("2026-08-02"),
      ),
    ).toBe(false);
  });

  test("verifies the exact dependency keys without accepting a changed test gate", () => {
    const baseline = JSON.stringify(baseManifest);
    const expected = expectedPinFile(samplePath, baseline, [target()]);
    const upgraded = {
      ...baseManifest,
      dependencies: { ...baseManifest.dependencies, first: "^2.0.0" },
    };
    expect(expected).toBe(actualPinFile(samplePath, JSON.stringify(upgraded)));
    expect(expected).not.toBe(
      actualPinFile(
        samplePath,
        JSON.stringify({ ...upgraded, scripts: { test: "true" } }),
      ),
    );
    expect(expected).not.toBe(
      actualPinFile(
        samplePath,
        JSON.stringify({
          ...upgraded,
          dependencies: { first: "^2.0.0", second: "^2.0.0" },
        }),
      ),
    );
    expect(
      expectedPinFile(samplePath, JSON.stringify(upgraded), [target()]),
    ).toBeUndefined();
  });

  test("requires the ranked old digest before deriving the new immutable pin", () => {
    const file = "packages/example/container.yml";
    const before = "image: example/service:4.0.0@sha256:old\n";
    const pin = {
      ...target("example/service"),
      filePath: file,
      currentValue: "4.0.0",
      targetValue: "4.0.0",
      currentDigest: "sha256:old",
      digest: "sha256:new",
    };
    expect(expectedPinFile(file, before, [pin])).toBe(
      "image: example/service:4.0.0@sha256:new\n",
    );
    expect(
      expectedPinFile(file, before, [{ ...pin, currentDigest: null }]),
    ).toBeUndefined();
    expect(
      expectedPinFile(file, before.replace("sha256:old", "sha256:changed"), [
        pin,
      ]),
    ).toBeUndefined();
  });

  test.each([
    "first: registry.example/first:9.0.0\nsecond: registry.example/second:1.2.3\n",
    "first: registry.example/first:9.0.0, second: registry.example/second:1.2.3\n",
    "second: registry.example/first-alias:1.2.3\n",
    "# first: registry.example/first:1.2.3\nfirst: registry.example/first:9.0.0\n",
    "image: 1.2.3\n",
  ])(
    "rejects a unique old version outside its own declaration: %j",
    (before) => {
      const filePath = "container.yaml";
      const pin = {
        ...target("registry.example/first"),
        filePath,
        currentValue: "1.2.3",
        targetValue: "2.0.0",
      };
      expect(expectedPinFile(filePath, before, [pin])).toBeUndefined();
    },
  );

  test("uses an exact declaration or adjacent package hint to disambiguate repeated versions", () => {
    const filePath = "versions.toml";
    const before = [
      "# renovate: datasource=docker depName=custom-caddy packageName=caddy",
      'CADDY = "1.2.3"',
      "# renovate: datasource=docker depName=caddy-other",
      'OTHER_CADDY = "1.2.3"',
      'rust = "1.2.3"',
      "",
    ].join("\n");
    const pin = {
      ...target("caddy"),
      filePath,
      currentValue: "1.2.3",
      targetValue: "2.0.0",
    };
    expect(
      expectedPinFile(filePath, before, [pin, { ...pin, packageName: "rust" }]),
    ).toBe(
      before
        .replace('CADDY = "1.2.3"', 'CADDY = "2.0.0"')
        .replace('rust = "1.2.3"', 'rust = "2.0.0"'),
    );
  });

  test("binds the companion commit to the same hinted version", () => {
    const filePath = "Dockerfile";
    const before = [
      "# renovate: datasource=github-tags depName=example/project",
      'ARG PROJECT_VERSION="1.2.3"',
      `ARG PROJECT_COMMIT=${"a".repeat(40)}`,
      "",
    ].join("\n");
    const pin = {
      ...target("example/project"),
      filePath,
      currentValue: "1.2.3",
      targetValue: "2.0.0",
      currentDigest: "a".repeat(40),
      digest: "b".repeat(40),
    };
    expect(expectedPinFile(filePath, before, [pin])).toBe(
      before.replace("1.2.3", "2.0.0").replace("a".repeat(40), "b".repeat(40)),
    );
    expect(
      expectedPinFile(
        filePath,
        before.replace("PROJECT_COMMIT=", "OTHER_COMMIT="),
        [pin],
      ),
    ).toBeUndefined();
  });

  test("separates alternatives for the same pin, while grouping compatible dependencies", () => {
    expect(
      canBundleTogether(candidate(), candidate("alternative", target())),
    ).toBe(false);
    expect(canBundleTogether(candidate(), candidate("second"))).toBe(true);
  });
});

describe("Renovate independent verification", () => {
  test("does not walk to the filesystem root for an unsafe target path", () => {
    expect(
      targetArtifactPaths(
        { ...target(), manager: "cargo", filePath: "/invalid/Cargo.toml" },
        new Set(),
      ),
    ).toEqual([]);
    expect(
      targetArtifactPaths(
        { ...target(), manager: "cargo", filePath: "valid/child/Cargo.toml" },
        new Set(["valid/Cargo.lock"]),
      ),
    ).toEqual(["valid/Cargo.lock"]);
  });

  test("finds a root solution for a nested locked project", () => {
    const repo = {
      repoDir: "/scratch",
      baseSha: "base",
      commandRunner: runCommand,
      trackedPaths: new Set([
        "App.sln",
        "src/App/App.csproj",
        "src/App/packages.lock.json",
      ]),
    };
    const update = candidate("dotnet", {
      ...target("NodaTime"),
      filePath: "src/App/App.csproj",
      manager: "nuget",
    });
    expect(missingVerification(repo, update, () => "dotnet")).toBeUndefined();
    expect(
      missingVerification(
        {
          ...repo,
          trackedPaths: new Set([
            "unrelated/App.sln",
            "src/App/packages.lock.json",
          ]),
        },
        update,
        () => "dotnet",
      ),
    ).toContain("No locked dotnet verification project");
  });

  test("verifies a new bracketed path even beside a previously tracked glob match", async () => {
    const workspace = await createScratchWorkspace("renovate-literal-test");
    const { repoDir } = workspace;
    const file = "packages/sample/routes/[id].ts";
    try {
      await sandboxRepo().deps.cloneRepo(repoDir);
      const globMatch = "packages/sample/routes/i.ts";
      await Bun.write(`${repoDir}/${globMatch}`, "export const route = 1;\n", {
        createPath: true,
      });
      await runCommand(["git", "add", "--", globMatch], { cwd: repoDir });
      await Bun.write(`${repoDir}/${file}`, "export const route = 2;\n");
      const first = await readBundleDiff(repoDir, [file], runCommand);
      expect(first).toContain(`+++ b/${file}`);
      expect(first).not.toContain(globMatch);
      await Bun.write(`${repoDir}/${file}`, "export const route = 3;\n");
      const after = await readBundleDiff(repoDir, [file], runCommand);
      expect(after).toContain("+export const route = 3;");
      expect(after).not.toBe(first);
    } finally {
      await workspace.cleanup();
    }
  });

  test.each([
    { args: ["uv", "sync", "--locked"], network: false },
    {
      args: ["uv", "sync", "--frozen", "--no-build", "--no-python-downloads"],
      network: false,
    },
    {
      args: [
        "uv",
        "sync",
        "--frozen",
        "--no-build",
        "--no-install-local",
        "--no-python-downloads",
      ],
      network: true,
    },
    { args: ["uv", "sync", "--locked", "--offline"], network: false },
    {
      args: ["uv", "run", "--offline", "--no-sync", "python", "-m", "unittest"],
      network: false,
    },
    { args: ["dotnet", "restore", "--locked-mode", "App.sln"], network: false },
  ])(
    "isolates network for the verification command %j",
    async ({ args, network }) => {
      const commandRunner = vi.fn((_args: string[]) => Promise.resolve(""));
      const runner = sandboxBundleVerification({
        tempDir: "/tmp/scratch",
        repoDir: "/tmp/scratch/monorepo",
        commandRunner,
      });
      await runner(args, { cwd: "/tmp/scratch/monorepo" });
      const wrapped = commandRunner.mock.calls[0]?.[0] ?? [];
      expect(wrapped.slice(wrapped.indexOf("--") + 1)).toEqual(args);
      expect(wrapped.includes("--share-net")).toBe(network);
    },
  );
});

describe("Renovate bundle executor", () => {
  test("publishes independently checked pins while the disposable checkout still exists", async () => {
    const { deps, verification } = sandboxRepo();
    const publish = vi.fn(async (bundle: VerifiedRenovateBundle) => {
      expect(await Bun.file(`${bundle.repoDir}/${samplePath}`).exists()).toBe(
        true,
      );
      expect(bundle.changedFiles).toEqual(["bun.lock", samplePath]);
      expect(bundle.demo).toContain("^1.0.0");
      expect(bundle.demo).toContain("^2.0.0");
      return {
        status: "published" as const,
        prUrl: "https://example.invalid/42",
        prNumber: 42,
        headSha: "verified",
      };
    });
    const result = await executeRenovateBundle(
      { candidates: [candidate(), candidate("second")] },
      publish,
      {
        ...deps,
        runBundleTurn: ({ repoDir }) => editPins(repoDir, ["first", "second"]),
      },
    );
    expect(result).toMatchObject({
      candidateIds: ["first", "second"],
      attemptedCandidateIds: ["first", "second"],
      dispositions: [],
      publication: { status: "published", prNumber: 42 },
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(verification).toEqual([
      "bun install --frozen-lockfile --ignore-scripts",
      "bunx --no-install turbo run build typecheck test lint test:extended --filter=...[HEAD] --continue",
    ]);
  });

  test("rejects an invalid group, retries from a fresh checkout, and keeps the partner queued", async () => {
    const { deps } = sandboxRepo();
    let runs = 0;
    const publish = vi.fn(() =>
      Promise.resolve({ status: "queued" as const, reason: "CI busy" }),
    );
    const result = await executeRenovateBundle(
      { candidates: [candidate(), candidate("second")] },
      publish,
      {
        ...deps,
        runBundleTurn: async ({ repoDir }) => {
          runs += 1;
          if (runs === 1) {
            await Bun.write(
              `${repoDir}/bypass.ts`,
              "throw new Error('unrelated');\n",
            );
            return editPins(repoDir, ["first", "second"]);
          }
          expect(await Bun.file(`${repoDir}/bypass.ts`).exists()).toBe(false);
          return editPins(repoDir, ["first"]);
        },
      },
    );
    expect(runs).toBe(2);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      candidateIds: ["first"],
      attemptedCandidateIds: ["first"],
      publication: { status: "queued", reason: "CI busy" },
    });
  });

  test("leaves open-lockfile work queued and surfaces exact dedicated proof", async () => {
    const { deps } = sandboxRepo();
    const runBundleTurn = vi.fn(() => Promise.resolve(undefined));
    const publish = vi.fn(() =>
      Promise.resolve({ status: "queued" as const, reason: "unused" }),
    );
    const native = candidate("platform", {
      ...target("gpui-kit"),
      manager: "cargo",
      filePath: "packages/scout-for-lol/packages/desktop/Cargo.toml",
    });
    const result = await executeRenovateBundle(
      { candidates: [candidate(), native], reservedPaths: ["bun.lock"] },
      publish,
      { ...deps, runBundleTurn },
    );
    expect(result).toMatchObject({
      candidateIds: [],
      attemptedCandidateIds: ["platform"],
      dispositions: [
        {
          id: "first",
          status: "reserved",
          reason: expect.stringContaining("open PR"),
        },
        {
          id: "platform",
          status: "blocked",
          reason: expect.stringContaining("Windows verification"),
        },
      ],
    });
    expect(runBundleTurn).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
