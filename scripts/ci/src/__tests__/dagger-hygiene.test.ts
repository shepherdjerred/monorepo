import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";

const repoRoot = execSync("git rev-parse --show-toplevel", {
  encoding: "utf8",
}).trim();

const daggerSrc = `${repoRoot}/.dagger/src`;

/** Read a source file's text for hygiene assertions. */
function readSource(path: string): Promise<string> {
  return Bun.file(path).text();
}

/**
 * Slice out a single exported helper's source (from its `export function` line
 * up to the next one) so per-helper assertions don't leak across helpers.
 */
function requireHelperSource(
  releaseSource: string,
  helperName: string,
): string {
  const start = releaseSource.indexOf(`export function ${helperName}(`);
  if (start === -1) {
    throw new Error(`Missing helper ${helperName}`);
  }

  const nextHelper = releaseSource.indexOf("\nexport function ", start + 1);
  if (nextHelper === -1) {
    return releaseSource.slice(start);
  }

  return releaseSource.slice(start, nextHelper);
}

/** Extract the `*_IMAGE = "..."` constant values from the Dagger constants file. */
async function getImageConstants(): Promise<string[]> {
  const constantsSource = await readSource(`${daggerSrc}/constants.ts`);
  const matches = constantsSource.matchAll(
    /export const \w+_IMAGE\s*=\s*"([^"]+)"/g,
  );
  return [...matches].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

describe("constant duplication", () => {
  it("SOURCE_EXCLUDES is defined in exactly one file", () => {
    const result = execSync(`grep -rl 'const SOURCE_EXCLUDES' ${daggerSrc}`, {
      encoding: "utf8",
    });
    const files = result.trim().split("\n").filter(Boolean);
    expect(files).toHaveLength(1);
  });

  it("BUN_IMAGE is defined in exactly one file", () => {
    const result = execSync(`grep -rl 'const BUN_IMAGE' ${daggerSrc}`, {
      encoding: "utf8",
    });
    const files = result.trim().split("\n").filter(Boolean);
    expect(files).toHaveLength(1);
  });

  it("BUN_CACHE is defined in exactly one file", () => {
    const result = execSync(`grep -rl 'const BUN_CACHE' ${daggerSrc}`, {
      encoding: "utf8",
    });
    const files = result.trim().split("\n").filter(Boolean);
    expect(files).toHaveLength(1);
  });
});

describe("resource tiers", () => {
  it("HEAVY, MEDIUM, LIGHT have different values", async () => {
    const catalogPath = `${repoRoot}/scripts/ci/src/catalog.ts`;
    const content = await readSource(catalogPath);

    const tierPattern =
      /const (HEAVY|MEDIUM|LIGHT):\s*ResourceTier\s*=\s*(\{[^}]+\})/g;
    const tiers: Record<string, string> = {};

    let match: RegExpExecArray | null;
    while ((match = tierPattern.exec(content)) !== null) {
      const name = match[1];
      const value = match[2];
      if (name === undefined || value === undefined) continue;
      tiers[name] = value.replaceAll(/\s+/g, " ").trim();
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
  it("uses a stable pending branch", async () => {
    const releaseSource = await readSource(`${daggerSrc}/release.ts`);
    expect(releaseSource).toContain(
      'const VERSION_BUMP_BRANCH = "chore/version-bump-pending"',
    );
    expect(releaseSource).toContain(`git rebase origin/main`);
  });

  it("does not close sibling version bump PRs", async () => {
    const releaseSource = await readSource(`${daggerSrc}/release.ts`);
    expect(releaseSource).not.toContain("gh pr close");
    expect(releaseSource).not.toContain("Superseded by");
  });

  it("uses GitHub App write auth and fail-fast PR commands", async () => {
    const releaseSource = await readSource(`${daggerSrc}/release.ts`);
    const helpers = [
      "versionCommitBackHelper",
      "ciBaseVersionCommitBackHelper",
      "cooklangVersionCommitBackHelper",
    ];

    expect(releaseSource).toContain(
      "const MONOREPO_WRITE_URL = `https://github.com/${MONOREPO_REPO}.git`",
    );
    // release.ts writes this via String.raw, so the source contains a single
    // backslash-n (same runtime string as the old `\\n` in a plain template).
    expect(releaseSource).toContain(
      String.raw`printf '%s\n' '#!/bin/sh' 'case "$1" in'`,
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
      // The monorepo only enables squash merges (see
      // packages/homelab/src/tofu/github/repos.tf: allow_squash_merge=true,
      // allow_rebase_merge=false, allow_merge_commit=false). Using --rebase
      // here makes GitHub return
      // "Merge method rebase merging is not allowed on this repository" and
      // the bump PR sits open instead of auto-merging (build #4330).
      expect(helperSource).toContain(
        'gh pr merge --repo ${MONOREPO_REPO} "$PR_NUMBER" --auto --squash',
      );
      expect(helperSource).not.toContain(
        'gh pr merge --repo ${MONOREPO_REPO} "$PR_NUMBER" --auto --rebase',
      );
      expect(helperSource).not.toContain(
        'gh pr merge --repo ${MONOREPO_REPO} "$PR_NUMBER" --auto --merge',
      );
      expect(helperSource).toContain(`test -n "$PR_NUMBER"`);
      expect(helperSource).not.toContain(">/dev/null 2>&1");
    }
  });
});

describe("cooklang versions compatibility boundaries", () => {
  it("does not unconditionally append every release to versions.json", async () => {
    const releaseSource = await readSource(`${daggerSrc}/release.ts`);

    expect(releaseSource).not.toContain("'. + {($v): $m}'");
    expect(releaseSource).toContain("latest_min=$(jq -r");
    expect(releaseSource).toContain(
      "versions.json compatibility boundary unchanged",
    );
  });

  it("documents versions.json as compatibility-boundary metadata", async () => {
    const indexSource = await readSource(`${daggerSrc}/index.ts`);
    const cooklangStepsSource = await readSource(
      `${repoRoot}/scripts/ci/src/steps/cooklang.ts`,
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
  it("uses the same Prisma startup command as production images", async () => {
    const imageSource = await readSource(`${daggerSrc}/image.ts`);
    const miscSource = await readSource(`${daggerSrc}/misc.ts`);

    expect(imageSource).toContain("PRISMA_BUN_SERVICE_START_COMMAND");
    expect(imageSource).toContain("bunx --trust prisma generate");
    expect(miscSource).toContain("PRISMA_BUN_SERVICE_START_COMMAND");
    expect(miscSource).toContain("/* usePrisma */ true");
    expect(miscSource).not.toContain("timeout 30s bun run start 2>&1");
  });
});

describe("image tags", () => {
  it("no image constant uses :latest", async () => {
    const images = await getImageConstants();
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image).not.toEndWith(":latest");
    }
  });

  it("all image constants have version-pinned tags", async () => {
    const images = await getImageConstants();
    expect(images.length).toBeGreaterThan(0);

    // A pinned tag contains at least one digit (version number)
    const versionTagPattern =
      /^.[^\n\r:\u2028\u2029]*:[^\d\n\r\u2028\u2029]*\d.*$/;
    for (const image of images) {
      expect(image).toMatch(versionTagPattern);
    }
  });
});
