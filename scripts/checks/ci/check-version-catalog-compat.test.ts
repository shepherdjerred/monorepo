import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkVersionCatalogCompat,
  extractCatalogImageNames,
  IMAGES_SOURCE_PATH,
  parseCatalogEntryNames,
  parseCliBaseRef,
  readGitBlob,
  resolveDefaultBaseRef,
  VERSION_CATALOG_PATH,
} from "./check-version-catalog-compat.ts";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const LEGACY_IMAGES_SOURCE = `
export type CatalogImageName =
  | "aquasec/trivy"
  | "minio/mc"
  | "pgsty/silo";

function resolve(catalog: string) {
  return {
    trivy: reference(catalog, "aquasec/trivy"),
    mc: reference(catalog, "minio/mc"),
    silo: reference(catalog, "pgsty/silo"),
  };
}
`;

const CONST_ARRAY_IMAGES_SOURCE = `
export const CATALOG_IMAGE_NAMES = [
  "aquasec/trivy",
  "pgsty/silo",
  "new/scanner",
] as const;

export type CatalogImageName = (typeof CATALOG_IMAGE_NAMES)[number];
`;

describe("extractCatalogImageNames", () => {
  test("extracts names from both legacy union/reference and CATALOG_IMAGE_NAMES forms", () => {
    expect(extractCatalogImageNames(LEGACY_IMAGES_SOURCE)).toEqual([
      "aquasec/trivy",
      "minio/mc",
      "pgsty/silo",
    ]);
    expect(extractCatalogImageNames(CONST_ARRAY_IMAGES_SOURCE)).toEqual([
      "aquasec/trivy",
      "new/scanner",
      "pgsty/silo",
    ]);
  });

  test("throws when no catalog image names can be extracted", () => {
    expect(() => extractCatalogImageNames("export const x = 1;\n")).toThrow(
      /Could not extract any catalog image names/u,
    );
  });
});

describe("parseCatalogEntryNames", () => {
  test("keeps non-empty entries and rejects malformed catalog JSON", () => {
    const names = parseCatalogEntryNames(
      JSON.stringify({
        entries: [
          { name: "aquasec/trivy", value: "0.50.0@sha256:abc" },
          { name: "empty/entry", value: "   " },
        ],
      }),
    );
    expect([...names]).toEqual(["aquasec/trivy"]);
    expect(() => parseCatalogEntryNames(JSON.stringify({ bad: true }))).toThrow(
      /unexpected shape/u,
    );
  });
});

describe("CLI base ref resolution", () => {
  test("resolves default and explicit --base flags while ignoring staged file args", () => {
    expect(resolveDefaultBaseRef({})).toBe("origin/main");
    expect(resolveDefaultBaseRef({ CI_CHANGED_BASE: "  abc123  " })).toBe(
      "abc123",
    );
    expect(
      parseCliBaseRef([VERSION_CATALOG_PATH, "--base", "HEAD~1"], {}),
    ).toBe("HEAD~1");
    expect(parseCliBaseRef(["--base=origin/main", IMAGES_SOURCE_PATH])).toBe(
      "origin/main",
    );
    expect(() => parseCliBaseRef(["--base"])).toThrow(
      /requires a git revision/u,
    );
    expect(() => parseCliBaseRef(["--base="])).toThrow(
      /requires a git revision/u,
    );
  });
});

describe("checkVersionCatalogCompat", () => {
  test("fails with a two-PR expand/contract message when a deployed image entry is deleted", async () => {
    const outcome = await checkVersionCatalogCompat({
      baseRef: "origin/main",
      readBaseImages: () => LEGACY_IMAGES_SOURCE,
      readCatalog: () =>
        JSON.stringify({
          entries: [
            { name: "aquasec/trivy", value: "1.0.0" },
            { name: "pgsty/silo", value: "1.0.0" },
          ],
        }),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected failure");
    expect(outcome.missing).toEqual(["minio/mc"]);
    expect(outcome.message).toContain("minio/mc");
    expect(outcome.message).toContain("two-PR expand/contract sequence");
  });

  test("passes when adding a new entry while keeping all origin/main entries", async () => {
    const outcome = await checkVersionCatalogCompat({
      baseRef: "origin/main",
      readBaseImages: () => LEGACY_IMAGES_SOURCE,
      readCatalog: () =>
        JSON.stringify({
          entries: [
            { name: "aquasec/trivy", value: "1.0.0" },
            { name: "minio/mc", value: "1.0.0" },
            { name: "pgsty/silo", value: "1.0.0" },
            { name: "brand/new-tool", value: "2.0.0" },
          ],
        }),
    });

    expect(outcome).toEqual({
      ok: true,
      checked: ["aquasec/trivy", "minio/mc", "pgsty/silo"],
    });
  });

  test("reads git blobs from a repository and skips cleanly when base ref is absent", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "catalog-compat-git-"));
    tempDirs.push(repo);
    const git = (...args: string[]) => {
      const res = Bun.spawnSync(["git", ...args], { cwd: repo });
      expect(res.exitCode, res.stderr.toString()).toBe(0);
    };
    git("init", "--quiet");
    await Bun.write(
      path.join(repo, IMAGES_SOURCE_PATH),
      CONST_ARRAY_IMAGES_SOURCE,
      { createPath: true },
    );
    await Bun.write(
      path.join(repo, VERSION_CATALOG_PATH),
      JSON.stringify({
        entries: [
          { name: "aquasec/trivy", value: "1.0.0" },
          { name: "pgsty/silo", value: "1.0.0" },
        ],
      }),
      { createPath: true },
    );
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "init",
    );

    expect(
      await checkVersionCatalogCompat({
        root: repo,
        baseRef: "nonexistent-ref",
      }),
    ).toEqual({ ok: true, checked: [] });

    expect(readGitBlob("HEAD", IMAGES_SOURCE_PATH, { cwd: repo })).toBe(
      CONST_ARRAY_IMAGES_SOURCE,
    );
    const failed = await checkVersionCatalogCompat({
      root: repo,
      baseRef: "HEAD",
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.missing).toEqual(["new/scanner"]);
    }
  });

  test("live repository catalog satisfies deployed woodpecker-config-extension", async () => {
    const headImages = await Bun.file(
      path.join(REPOSITORY_ROOT, IMAGES_SOURCE_PATH),
    ).text();
    const headNames = extractCatalogImageNames(headImages);
    expect(headNames.length).toBeGreaterThanOrEqual(8);

    const outcome = await checkVersionCatalogCompat({ root: REPOSITORY_ROOT });
    expect(outcome.ok).toBe(true);
  });
});
