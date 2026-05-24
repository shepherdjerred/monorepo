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
  function requireHelperSource(releaseSource: string, helperName: string) {
    const start = releaseSource.indexOf(`export function ${helperName}(`);
    if (start === -1) {
      throw new Error(`Missing helper ${helperName}`);
    }

    const nextHelper = releaseSource.indexOf("\n/**", start + 1);
    if (nextHelper === -1) {
      return releaseSource.slice(start);
    }

    return releaseSource.slice(start, nextHelper);
  }

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

  it("uses GitHub App write auth and fail-fast PR commands", () => {
    const releaseSource = readFileSync(`${daggerSrc}/release.ts`, "utf-8");
    const helpers = [
      "versionCommitBackHelper",
      "ciBaseVersionCommitBackHelper",
      "cooklangVersionCommitBackHelper",
    ];

    expect(releaseSource).toContain(
      "const MONOREPO_WRITE_URL = `https://git@github.com/${MONOREPO_REPO}.git`",
    );
    expect(releaseSource).toContain(
      String.raw`printf '#!/bin/sh\\nprintf "%s\\\\n" "$GH_TOKEN"\\n'`,
    );
    expect(releaseSource).not.toContain(["x-access", "-token"].join(""));

    for (const helper of helpers) {
      const helperSource = requireHelperSource(releaseSource, helper);

      expect(helperSource).toContain("`set -eu`");
      expect(helperSource).toContain("`export GIT_TERMINAL_PROMPT=0`");
      expect(helperSource).toContain("`git clone ${MONOREPO_WRITE_URL} /repo`");
      expect(helperSource).toContain("gh pr list --repo ${MONOREPO_REPO}");
      expect(helperSource).toContain("gh pr create --repo ${MONOREPO_REPO}");
      expect(helperSource).toContain("gh pr view --repo ${MONOREPO_REPO}");
      expect(helperSource).toContain("gh pr merge --repo ${MONOREPO_REPO}");
      expect(helperSource).toContain(`test -n "$PR_NUMBER"`);
      expect(helperSource).not.toContain(">/dev/null 2>&1");
    }
  });
});

describe("cooklang versions compatibility boundaries", () => {
  it("does not unconditionally append every release to versions.json", () => {
    const releaseSource = readFileSync(`${daggerSrc}/release.ts`, "utf-8");

    expect(releaseSource).not.toContain("'. + {($v): $m}'");
    expect(releaseSource).toContain("latest_min=$(jq -r");
    expect(releaseSource).toContain(
      "versions.json compatibility boundary unchanged",
    );
  });

  it("documents versions.json as compatibility-boundary metadata", () => {
    const indexSource = readFileSync(`${daggerSrc}/index.ts`, "utf-8");
    const cooklangStepsSource = readFileSync(
      `${repoRoot}/scripts/ci/src/steps/cooklang.ts`,
      "utf-8",
    );

    expect(indexSource).toContain("compatibility boundary");
    expect(cooklangStepsSource).toContain("compatibility boundary");
    expect(indexSource).not.toContain("update manifest + versions.json");
    expect(cooklangStepsSource).not.toContain(
      "updates manifest + versions.json",
    );
  });
});

describe("Birmel smoke coverage", () => {
  it("uses the same Prisma startup command as production images", () => {
    const imageSource = readFileSync(`${daggerSrc}/image.ts`, "utf-8");
    const miscSource = readFileSync(`${daggerSrc}/misc.ts`, "utf-8");

    expect(imageSource).toContain("PRISMA_BUN_SERVICE_START_COMMAND");
    expect(imageSource).toContain("bunx --trust prisma generate");
    expect(miscSource).toContain("PRISMA_BUN_SERVICE_START_COMMAND");
    expect(miscSource).toContain("/* usePrisma */ true");
    expect(miscSource).not.toContain("timeout 30s bun run start 2>&1");
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
