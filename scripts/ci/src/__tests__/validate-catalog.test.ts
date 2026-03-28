import { describe, expect, it } from "bun:test";
import { validateCatalog } from "../lib/validate-catalog.ts";
import {
  ALL_PACKAGES,
  IMAGE_PUSH_TARGETS,
  INFRA_PUSH_TARGETS,
  PACKAGES_WITH_IMAGES,
  DEPLOY_SITES,
  PACKAGE_TO_SITE,
  SKIP_PACKAGES,
} from "../catalog.ts";
import { readdir } from "node:fs/promises";
import { execSync } from "node:child_process";

const repoRoot = execSync("git rev-parse --show-toplevel", {
  encoding: "utf-8",
}).trim();

describe("validateCatalog", () => {
  it("passes with the current catalog (integration test)", async () => {
    // Should not throw — the current catalog must be valid
    await validateCatalog();
  });
});

describe("catalog consistency", () => {
  it("ALL_PACKAGES matches packages/ directories", async () => {
    const dirs = await readdir(`${repoRoot}/packages`, { withFileTypes: true });
    const actual = dirs
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const catalog = [...ALL_PACKAGES].sort();
    expect(catalog).toEqual(actual);
  });

  it("PACKAGES_WITH_IMAGES entries are all in ALL_PACKAGES", () => {
    const catalogSet = new Set(ALL_PACKAGES);
    for (const pkg of PACKAGES_WITH_IMAGES) {
      expect(catalogSet.has(pkg)).toBe(true);
    }
  });

  it("IMAGE_PUSH_TARGETS resolve to ALL_PACKAGES entries", () => {
    const catalogSet = new Set(ALL_PACKAGES);
    for (const img of [...IMAGE_PUSH_TARGETS, ...INFRA_PUSH_TARGETS]) {
      const resolved = img.package ?? img.name;
      if (!img.neededPackages?.length) {
        expect(catalogSet.has(resolved)).toBe(true);
      }
    }
  });

  it("PACKAGE_TO_SITE keys are in ALL_PACKAGES", () => {
    const catalogSet = new Set(ALL_PACKAGES);
    for (const pkg of Object.keys(PACKAGE_TO_SITE)) {
      expect(catalogSet.has(pkg)).toBe(true);
    }
  });

  it("PACKAGE_TO_SITE values match DEPLOY_SITES buckets", () => {
    const buckets = new Set(DEPLOY_SITES.map((s) => s.bucket));
    for (const bucket of Object.values(PACKAGE_TO_SITE)) {
      expect(buckets.has(bucket)).toBe(true);
    }
  });

  it("SKIP_PACKAGES entries are in ALL_PACKAGES", () => {
    const catalogSet = new Set(ALL_PACKAGES);
    for (const pkg of SKIP_PACKAGES) {
      expect(catalogSet.has(pkg)).toBe(true);
    }
  });

  it("no duplicate entries in ALL_PACKAGES", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const pkg of ALL_PACKAGES) {
      if (seen.has(pkg)) dupes.push(pkg);
      seen.add(pkg);
    }
    expect(dupes).toEqual([]);
  });
});
