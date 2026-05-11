import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const repoRoot = execSync("git rev-parse --show-toplevel", {
  encoding: "utf-8",
}).trim();

const daggerSrc = `${repoRoot}/.dagger/src`;

describe("constant duplication", () => {
  it("SOURCE_EXCLUDES is defined in exactly one file", () => {
    const result = execSync(`grep -rl 'const SOURCE_EXCLUDES' ${daggerSrc}`, {
      encoding: "utf-8",
    });
    const files = result.trim().split("\n").filter(Boolean);
    expect(files).toHaveLength(1);
  });

  it("BUN_IMAGE is defined in exactly one file", () => {
    const result = execSync(`grep -rl 'const BUN_IMAGE' ${daggerSrc}`, {
      encoding: "utf-8",
    });
    const files = result.trim().split("\n").filter(Boolean);
    expect(files).toHaveLength(1);
  });

  it("BUN_CACHE is defined in exactly one file", () => {
    const result = execSync(`grep -rl 'const BUN_CACHE' ${daggerSrc}`, {
      encoding: "utf-8",
    });
    const files = result.trim().split("\n").filter(Boolean);
    expect(files).toHaveLength(1);
  });
});

describe("resource tiers", () => {
  it("HEAVY, MEDIUM, LIGHT have different values", () => {
    const catalogPath = `${repoRoot}/scripts/ci/src/catalog.ts`;
    const content = readFileSync(catalogPath, "utf-8");

    const tierPattern =
      /const (HEAVY|MEDIUM|LIGHT):\s*ResourceTier\s*=\s*(\{[^}]+\})/g;
    const tiers: Record<string, string> = {};

    let match: RegExpExecArray | null;
    while ((match = tierPattern.exec(content)) !== null) {
      const name = match[1];
      const value = match[2];
      if (name === undefined || value === undefined) continue;
      tiers[name] = value.replace(/\s+/g, " ").trim();
    }

    expect(Object.keys(tiers)).toHaveLength(3);
    const values = Object.values(tiers);
    // All three should be distinct
    const unique = new Set(values);
    expect(unique.size).toBe(3);
  });
});

describe("retry config", () => {
  it("at least one retry limit is non-zero", async () => {
    const { RETRY } = await import("../lib/buildkite.ts");
    const hasNonZero = RETRY.automatic.some(
      (entry: { limit: number }) => entry.limit > 0,
    );
    expect(hasNonZero).toBe(true);
  });
});

describe("version commit-back", () => {
  it("uses a stable pending branch", () => {
    const releaseSource = readFileSync(`${daggerSrc}/release.ts`, "utf-8");
    expect(releaseSource).toContain(
      'const VERSION_BUMP_BRANCH = "chore/version-bump-pending"',
    );
    expect(releaseSource).toContain(`git rebase origin/main`);
  });

  it("does not close sibling version bump PRs", () => {
    const releaseSource = readFileSync(`${daggerSrc}/release.ts`, "utf-8");
    expect(releaseSource).not.toContain("gh pr close");
    expect(releaseSource).not.toContain("Superseded by");
  });
});

describe("image tags", () => {
  function getImageConstants(): string[] {
    const constantsSource = readFileSync(`${daggerSrc}/constants.ts`, "utf-8");
    const matches = constantsSource.matchAll(
      /export const \w+_IMAGE\s*=\s*"([^"]+)"/gs,
    );
    return Array.from(matches, (match) => match[1]).filter(
      (value): value is string => value !== undefined,
    );
  }

  it("no image constant uses :latest", () => {
    const images = getImageConstants();
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image).not.toEndWith(":latest");
    }
  });

  it("all image constants have version-pinned tags", () => {
    const images = getImageConstants();
    expect(images.length).toBeGreaterThan(0);

    // A pinned tag contains at least one digit (version number)
    const versionTagPattern = /^.+:.*\d+.*$/;
    for (const image of images) {
      expect(image).toMatch(versionTagPattern);
    }
  });
});
