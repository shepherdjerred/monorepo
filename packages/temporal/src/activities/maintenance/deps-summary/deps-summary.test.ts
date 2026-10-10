import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { z } from "zod/v4";
import {
  catalogAt,
  CatalogEntrySchema,
  DEPS_SUMMARY_CLONE_ARGS,
  deriveDependencyChanges,
  VERSION_CATALOG_PATH,
  type CatalogEntry,
} from "./deps-summary.ts";

const HistoricalFixtureSchema = z.object({
  window: z.object({
    baseSha: z.string().regex(/^[a-f0-9]{40}$/),
    headSha: z.string().regex(/^[a-f0-9]{40}$/),
    headSubject: z.string().min(1),
  }),
  baseEntries: z.array(CatalogEntrySchema),
  headEntries: z.array(CatalogEntrySchema),
  expected: z.object({
    managedUpgrades: z.number().int().nonnegative(),
    otherChangedPins: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    digestOnlyChanges: z.number().int().nonnegative(),
  }),
});

function upstream(name: string, value: string): CatalogEntry {
  return {
    name,
    value,
    category: "upstream",
    artifactType: "source",
    management: {
      managed: true,
      datasource: "github-releases",
      versioning: "semver",
    },
  };
}

function internal(name: string, value: string): CatalogEntry {
  return {
    name,
    value,
    category: "internal-image",
    artifactType: "image",
    management: { managed: false },
  };
}

describe("dependency summary collection", () => {
  it("uses a blobless full-history main clone", () => {
    expect(DEPS_SUMMARY_CLONE_ARGS).toContain("--filter=blob:none");
    expect(DEPS_SUMMARY_CLONE_ARGS).toContain("--single-branch");
    expect(DEPS_SUMMARY_CLONE_ARGS).toContain("--branch=main");
    expect(
      DEPS_SUMMARY_CLONE_ARGS.some((arg) => arg.startsWith("--shallow")),
    ).toBe(false);
  });

  it("preserves intermediate upgrades and reverts chronologically", () => {
    const base = [upstream("owner/tool", "1.0.0")];
    const changes = deriveDependencyChanges(base, [
      {
        commitSha: "a".repeat(40),
        commitSubject: "upgrade",
        entries: [upstream("owner/tool", "2.0.0")],
      },
      {
        commitSha: "b".repeat(40),
        commitSubject: "revert",
        entries: [upstream("owner/tool", "1.0.0")],
      },
    ]);
    expect(changes.map((change) => change.kind)).toEqual([
      "upstream-upgrade",
      "revert",
    ]);
  });

  it("classifies digest-only internal promotions", () => {
    const oldDigest = `1.0.0@sha256:${"a".repeat(64)}`;
    const newDigest = `1.0.0@sha256:${"b".repeat(64)}`;
    const changes = deriveDependencyChanges(
      [internal("shepherdjerred/service", oldDigest)],
      [
        {
          commitSha: "c".repeat(40),
          commitSubject: "promote image",
          entries: [internal("shepherdjerred/service", newDigest)],
        },
      ],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe("internal-promotion");
    expect(changes[0]?.oldVersion).toBe(changes[0]?.newVersion);
    expect(changes[0]).toMatchObject({
      datasource: "docker",
      registryUrl: "https://ghcr.io",
      packageName: "shepherdjerred/service",
    });
  });

  it.each([
    "shepherdjerred/scout-for-lol/beta",
    "shepherdjerred/scout-for-lol/prod/workflows/candidate",
    "shepherdjerred/scout-for-lol/beta/workflows/stable",
    "shepherdjerred/temporal-worker/workflows/stable",
  ])("resolves deployment alias %s to its actual image repository", (name) => {
    const changes = deriveDependencyChanges(
      [],
      [
        {
          commitSha: "a".repeat(40),
          commitSubject: "add deployment pin",
          entries: [internal(name, `1.0.0@sha256:${"b".repeat(64)}`)],
        },
      ],
    );
    expect(changes[0]?.packageName).toBe(name.split("/").slice(0, 2).join("/"));
  });

  it("rejects unknown internal image identity instead of querying another repository", () => {
    expect(() =>
      deriveDependencyChanges(
        [],
        [
          {
            commitSha: "a".repeat(40),
            commitSubject: "invalid pin",
            entries: [internal("shepherdjerred/service/unknown", "1.0.0")],
          },
        ],
      ),
    ).toThrow("Unknown internal image catalog identity");
  });

  it("regresses the actual July 6-13 missed-update endpoint states", async () => {
    const fixture = HistoricalFixtureSchema.parse(
      await Bun.file(
        new URL("../../fixtures/deps-summary-july-6-13.json", import.meta.url)
          .pathname,
      ).json(),
    );
    const changes = deriveDependencyChanges(fixture.baseEntries, [
      {
        commitSha: fixture.window.headSha,
        commitSubject: fixture.window.headSubject,
        entries: fixture.headEntries,
      },
    ]);
    const managedUpgrades = changes.filter(
      (change) =>
        change.category === "upstream" &&
        change.datasource !== undefined &&
        change.oldValue !== undefined &&
        change.newValue !== undefined &&
        change.oldVersion !== change.newVersion,
    );
    const otherChangedPins = changes.filter(
      (change) =>
        change.category === "internal-image" &&
        change.oldValue !== undefined &&
        change.newValue !== undefined,
    );
    const additions = changes.filter((change) => change.kind === "addition");
    const digestOnlyChanges = changes.filter(
      (change) =>
        change.category === "upstream" &&
        change.oldValue !== change.newValue &&
        change.oldVersion === change.newVersion,
    );

    expect(managedUpgrades).toHaveLength(fixture.expected.managedUpgrades);
    expect(otherChangedPins).toHaveLength(fixture.expected.otherChangedPins);
    expect(additions).toHaveLength(fixture.expected.additions);
    expect(digestOnlyChanges).toHaveLength(fixture.expected.digestOnlyChanges);
  });
});

describe("dependency catalog history", () => {
  it("reads the catalog at a revision and fails loudly where none exists", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "deps-summary-git-"));
    try {
      const git = simpleGit(directory);
      await git.init();
      await git.addConfig("user.email", "test@example.test");
      await git.addConfig("user.name", "test");
      await Bun.write(path.join(directory, "README.md"), "no catalog yet\n");
      await git.add(["README.md"]);
      await git.commit("before the catalog");
      const beforeShaRaw = await git.revparse(["HEAD"]);
      const beforeSha = beforeShaRaw.trim();

      await mkdir(path.join(directory, path.dirname(VERSION_CATALOG_PATH)), {
        recursive: true,
      });
      await Bun.write(
        path.join(directory, VERSION_CATALOG_PATH),
        JSON.stringify({
          schemaVersion: 1,
          entries: [
            {
              name: "owner/image",
              value: "2.0.0",
              category: "upstream",
              artifactType: "image",
              management: { managed: false },
            },
          ],
        }),
      );
      await git.add([VERSION_CATALOG_PATH]);
      await git.commit("add the catalog");
      const catalogShaRaw = await git.revparse(["HEAD"]);
      const catalogSha = catalogShaRaw.trim();

      const entries = await catalogAt(git, catalogSha);
      expect(entries.map((entry) => entry.value)).toEqual(["2.0.0"]);
      await expect(catalogAt(git, beforeSha)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
