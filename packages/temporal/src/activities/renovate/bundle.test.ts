import { describe, expect, test, vi } from "vitest";
import {
  isRenovateUpdateEligible,
  type RankedRenovateUpdate,
  type RenovateTarget,
} from "@shepherdjerred/ops-model/renovate-ranking.ts";
import { runCommand } from "#activities/scout/scout-season-refresh-git.ts";
import { actualPinFile, expectedPinFile } from "./bundle-pins.ts";
import { canBundleTogether } from "./bundle-policy.ts";
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

  test("separates alternatives for the same pin, while grouping compatible dependencies", () => {
    expect(
      canBundleTogether(candidate(), candidate("alternative", target())),
    ).toBe(false);
    expect(canBundleTogether(candidate(), candidate("second"))).toBe(true);
  });
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
