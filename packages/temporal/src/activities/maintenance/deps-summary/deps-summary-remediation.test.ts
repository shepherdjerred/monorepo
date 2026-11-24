import { z } from "zod/v4";
import { describe, expect, test } from "vitest";
import type { DependencyChange } from "#shared/deps-summary-types.ts";
import { verifyCatalogReleaseNoteDiff } from "./deps-summary-remediation.ts";
import type { MissingReleaseNote } from "./deps-summary-release-notes.ts";

const MutableCatalogSchema = z.object({
  $schema: z.string(),
  schemaVersion: z.number(),
  entries: z.array(z.record(z.string(), z.unknown())),
});

const BASE_CATALOG = JSON.stringify(
  {
    $schema: "./schema.json",
    schemaVersion: 1,
    entries: [
      {
        name: "owner/tool",
        value: "2.0.0",
        category: "upstream",
        artifactType: "source",
        management: {
          managed: true,
          datasource: "github-releases",
          versioning: "semver",
          packageName: "owner/tool",
        },
        notes: ["Existing operator note"],
      },
      {
        name: "other/pkg",
        value: "1.4.0",
        category: "upstream",
        artifactType: "package",
        management: { managed: false },
      },
    ],
  },
  null,
  2,
);

const CHANGES: DependencyChange[] = [
  {
    name: "owner/tool",
    category: "upstream",
    artifactType: "source",
    datasource: "github-releases",
    registryUrl: undefined,
    packageName: "owner/tool",
    oldValue: "1.0.0",
    newValue: "2.0.0",
    oldVersion: "1.0.0",
    newVersion: "2.0.0",
    kind: "upstream-upgrade",
    commitSha: "a".repeat(40),
    commitSubject: "chore(deps): update owner/tool to 2.0.0",
    releaseNotesOverride: undefined,
  },
];

const MISSING: MissingReleaseNote[] = [
  {
    dependency: "owner/tool",
    commitSha: "a".repeat(40),
    attempts: [],
  },
];

describe("verifyCatalogReleaseNoteDiff", () => {
  test("accepts releaseNotesOverride on a missing entry when URL returns HTTP 200", async () => {
    const parsed = MutableCatalogSchema.parse(JSON.parse(BASE_CATALOG));
    parsed.entries[0] = {
      ...parsed.entries[0],
      releaseNotesOverride: {
        url: "https://example.com/owner/tool/v2.0.0",
        summary: "Adds streaming support and removes deprecated v1 flags.",
      },
    };

    const result = await verifyCatalogReleaseNoteDiff({
      beforeCatalogText: BASE_CATALOG,
      afterCatalogText: JSON.stringify(parsed, null, 2),
      changes: CHANGES,
      missing: MISSING,
      verifyHttp200: (url) =>
        Promise.resolve(url === "https://example.com/owner/tool/v2.0.0"),
    });

    expect(result.valid).toBe(true);
    if (!result.valid) {
      throw new Error("Expected valid diff");
    }
    expect(result.resolvedNotes).toEqual([
      {
        dependency: "owner/tool",
        version: "2.0.0",
        notes: "Adds streaming support and removes deprecated v1 flags.",
        url: "https://example.com/owner/tool/v2.0.0",
        source: "catalog-override",
      },
    ]);
  });

  test("rejects modifying non-override fields or non-missing entries or adding/removing entries", async () => {
    const mutatedVersion = MutableCatalogSchema.parse(JSON.parse(BASE_CATALOG));
    mutatedVersion.entries[0] = {
      ...mutatedVersion.entries[0],
      value: "2.0.1",
      releaseNotesOverride: {
        url: "https://example.com/notes",
        summary: "Sneaky bump",
      },
    };
    const versionResult = await verifyCatalogReleaseNoteDiff({
      beforeCatalogText: BASE_CATALOG,
      afterCatalogText: JSON.stringify(mutatedVersion),
      changes: CHANGES,
      missing: MISSING,
      verifyHttp200: () => Promise.resolve(true),
    });
    expect(versionResult.valid).toBe(false);

    const mutatedUnrelated = MutableCatalogSchema.parse(
      JSON.parse(BASE_CATALOG),
    );
    mutatedUnrelated.entries[1] = {
      ...mutatedUnrelated.entries[1],
      releaseNotesOverride: {
        url: "https://example.com/other",
        summary: "Unrequested override",
      },
    };
    const unrelatedResult = await verifyCatalogReleaseNoteDiff({
      beforeCatalogText: BASE_CATALOG,
      afterCatalogText: JSON.stringify(mutatedUnrelated),
      changes: CHANGES,
      missing: MISSING,
      verifyHttp200: () => Promise.resolve(true),
    });
    expect(unrelatedResult.valid).toBe(false);

    const removedEntry = MutableCatalogSchema.parse(JSON.parse(BASE_CATALOG));
    removedEntry.entries = removedEntry.entries.slice(0, 1);
    const removedResult = await verifyCatalogReleaseNoteDiff({
      beforeCatalogText: BASE_CATALOG,
      afterCatalogText: JSON.stringify(removedEntry),
      changes: CHANGES,
      missing: MISSING,
      verifyHttp200: () => Promise.resolve(true),
    });
    expect(removedResult.valid).toBe(false);
  });

  test("rejects overrides whose URL does not return HTTP 200", async () => {
    const parsed = MutableCatalogSchema.parse(JSON.parse(BASE_CATALOG));
    parsed.entries[0] = {
      ...parsed.entries[0],
      releaseNotesOverride: {
        url: "https://example.com/404",
        summary: "Unreachable URL",
      },
    };

    const result = await verifyCatalogReleaseNoteDiff({
      beforeCatalogText: BASE_CATALOG,
      afterCatalogText: JSON.stringify(parsed),
      changes: CHANGES,
      missing: MISSING,
      verifyHttp200: () => Promise.resolve(false),
    });
    expect(result).toEqual({
      valid: false,
      reason:
        "releaseNotesOverride.url 'https://example.com/404' on 'owner/tool' did not return HTTP 200.",
    });
  });

  test("associates proposed overrides only with the missing current catalog version across multi-upgrade windows", async () => {
    const catalogAtV3 = MutableCatalogSchema.parse(JSON.parse(BASE_CATALOG));
    catalogAtV3.entries[0] = {
      ...catalogAtV3.entries[0],
      value: "3.0.0",
    };
    const beforeV3Text = JSON.stringify(catalogAtV3, null, 2);
    catalogAtV3.entries[0] = {
      ...catalogAtV3.entries[0],
      releaseNotesOverride: {
        url: "https://example.com/owner/tool/v3.0.0",
        summary: "v3.0.0 switches to zero-copy framing.",
      },
    };

    const v2Commit = "a".repeat(40);
    const v3Commit = "c".repeat(40);
    const multiChanges: DependencyChange[] = [
      ...CHANGES,
      {
        ...CHANGES[0]!,
        oldValue: "2.0.0",
        newValue: "3.0.0",
        oldVersion: "2.0.0",
        newVersion: "3.0.0",
        commitSha: v3Commit,
        commitSubject: "chore(deps): update owner/tool to 3.0.0",
      },
    ];

    // v2 had fetched notes; only v3 is missing: must emit ONLY v3 override note
    const onlyV3MissingResult = await verifyCatalogReleaseNoteDiff({
      beforeCatalogText: beforeV3Text,
      afterCatalogText: JSON.stringify(catalogAtV3, null, 2),
      changes: multiChanges,
      missing: [
        { dependency: "owner/tool", commitSha: v3Commit, attempts: [] },
      ],
      verifyHttp200: () => Promise.resolve(true),
    });
    expect(onlyV3MissingResult.valid).toBe(true);
    if (!onlyV3MissingResult.valid) {
      throw new Error("Expected valid v3 override");
    }
    expect(onlyV3MissingResult.resolvedMissingCount).toBe(1);
    expect(onlyV3MissingResult.resolvedNotes).toEqual([
      {
        dependency: "owner/tool",
        version: "3.0.0",
        notes: "v3.0.0 switches to zero-copy framing.",
        url: "https://example.com/owner/tool/v3.0.0",
        source: "catalog-override",
      },
    ]);

    // Both v2 and v3 missing: catalog.json at 3.0.0 resolves only v3 (1 of 2 missing)
    const bothMissingResult = await verifyCatalogReleaseNoteDiff({
      beforeCatalogText: beforeV3Text,
      afterCatalogText: JSON.stringify(catalogAtV3, null, 2),
      changes: multiChanges,
      missing: [
        { dependency: "owner/tool", commitSha: v2Commit, attempts: [] },
        { dependency: "owner/tool", commitSha: v3Commit, attempts: [] },
      ],
      verifyHttp200: () => Promise.resolve(true),
    });
    expect(bothMissingResult.valid).toBe(true);
    if (bothMissingResult.valid) {
      expect(bothMissingResult.resolvedMissingCount).toBe(1);
      expect(bothMissingResult.resolvedNotes).toHaveLength(1);
      expect(bothMissingResult.resolvedNotes[0]?.version).toBe("3.0.0");
    }

    // Only v2 missing while catalog.json is already at 3.0.0 (which had notes): reject stale override
    const staleMissingResult = await verifyCatalogReleaseNoteDiff({
      beforeCatalogText: beforeV3Text,
      afterCatalogText: JSON.stringify(catalogAtV3, null, 2),
      changes: multiChanges,
      missing: [
        { dependency: "owner/tool", commitSha: v2Commit, attempts: [] },
      ],
      verifyHttp200: () => Promise.resolve(true),
    });
    expect(staleMissingResult.valid).toBe(false);
  });
});
