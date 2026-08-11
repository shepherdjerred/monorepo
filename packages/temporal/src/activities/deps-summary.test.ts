import { describe, expect, it } from "bun:test";
import { z } from "zod/v4";
import {
  CatalogEntrySchema,
  DEPS_SUMMARY_CLONE_ARGS,
  deriveDependencyChanges,
  parseLegacyVersionsSource,
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

  it("parses multiline, bare-key, and digest legacy entries", () => {
    const source = `const versions = {
  // renovate: datasource=helm registryUrl=https://charts.example.test versioning=semver
  chart: "1.2.3",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "owner/image":
    "2.0.0@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};`;
    const entries = parseLegacyVersionsSource(source);
    expect(entries.map((entry) => entry.name)).toEqual([
      "chart",
      "owner/image",
    ]);
    expect(entries[0]?.artifactType).toBe("helm-chart");
    expect(entries[1]?.value).toEndWith("a".repeat(64));
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
  });

  it("regresses the actual July 6-13 missed-update endpoint states", async () => {
    const fixture = HistoricalFixtureSchema.parse(
      await Bun.file(
        new URL("fixtures/deps-summary-july-6-13.json", import.meta.url)
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
