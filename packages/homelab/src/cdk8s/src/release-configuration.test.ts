import { describe, expect, test } from "vitest";
import {
  applyCurrentBuildImageOverrides,
  catalogScoutPostgresImageDigests,
  releaseChartRevisions,
  scoutImageUsesPostgres,
} from "./release-configuration.ts";

describe("applyCurrentBuildImageOverrides", () => {
  test("updates bare and beta pins but never prod", () => {
    const versions: Record<string, string> = {
      "shepherdjerred/worker": "old@sha256:old",
      "shepherdjerred/scout/beta": "old@sha256:old",
      "shepherdjerred/scout/prod": "old@sha256:prod",
    };
    const postgresImageDigests = applyCurrentBuildImageOverrides(
      versions,
      JSON.stringify({
        "shepherdjerred/worker": `sha256:${"a".repeat(64)}`,
        "shepherdjerred/scout": `sha256:${"b".repeat(64)}`,
      }),
      "2.0.0-42",
    );
    expect(versions).toEqual({
      "shepherdjerred/worker": `2.0.0-42@sha256:${"a".repeat(64)}`,
      "shepherdjerred/scout/beta": `2.0.0-42@sha256:${"b".repeat(64)}`,
      "shepherdjerred/scout/prod": "old@sha256:prod",
    });
    expect(postgresImageDigests).toEqual(new Set());

    const scoutVersions: Record<string, string> = {
      "shepherdjerred/scout-for-lol/beta": "old@sha256:old",
    };
    const migratedDigests = applyCurrentBuildImageOverrides(
      scoutVersions,
      JSON.stringify({
        "shepherdjerred/scout-for-lol/beta": `sha256:${"c".repeat(64)}`,
      }),
      "2.0.0-43",
    );
    expect(migratedDigests).toEqual(new Set([`sha256:${"c".repeat(64)}`]));
  });

  test("fails on an unknown image key", () => {
    expect(() =>
      applyCurrentBuildImageOverrides(
        {},
        JSON.stringify({ unknown: `sha256:${"a".repeat(64)}` }),
        "2.0.0-42",
      ),
    ).toThrow("does not match");
  });

  test("accepts an empty image result without a synthetic version bump", () => {
    const versions: Record<string, string> = {
      "shepherdjerred/worker": "old@sha256:old",
    };
    const postgresImageDigests = applyCurrentBuildImageOverrides(
      versions,
      "{}",
    );
    expect(versions).toEqual({
      "shepherdjerred/worker": "old@sha256:old",
    });
    expect(postgresImageDigests).toEqual(new Set());
  });
});

test("releaseChartRevisions validates exact build revisions", () => {
  expect(releaseChartRevisions(JSON.stringify({ worker: "2.0.0-42" }))).toEqual(
    { worker: "2.0.0-42" },
  );
  expect(() =>
    releaseChartRevisions(JSON.stringify({ worker: "~2.0.0-0" })),
  ).toThrow();
});

test("classifies Scout images from current-build provenance", () => {
  const postgresImageDigests = new Set([
    "sha256:513c2c6ef457ee91b8a18ec2c6f999558617560f57b21cc70440e3ab833c0347",
  ]);
  expect(
    scoutImageUsesPostgres(
      "2.0.0-10860@sha256:c79be8f789dc48b8add32d5c633be88a881899cef91beb8efd450fba483474ff",
      postgresImageDigests,
    ),
  ).toBe(false);
  expect(
    scoutImageUsesPostgres(
      "2.0.0-10861@sha256:513c2c6ef457ee91b8a18ec2c6f999558617560f57b21cc70440e3ab833c0347",
      postgresImageDigests,
    ),
  ).toBe(true);
});

test("preserves Scout PostgreSQL provenance from the catalog", () => {
  expect(
    catalogScoutPostgresImageDigests({
      $schema: "test",
      schemaVersion: 1,
      entries: [
        {
          name: "shepherdjerred/scout-for-lol/beta",
          value:
            "2.0.0-10861@sha256:513c2c6ef457ee91b8a18ec2c6f999558617560f57b21cc70440e3ab833c0347",
          category: "internal-image",
          artifactType: "image",
          management: { managed: false },
          notes: ["database contract: postgresql"],
        },
      ],
    }),
  ).toEqual(
    new Set([
      "sha256:513c2c6ef457ee91b8a18ec2c6f999558617560f57b21cc70440e3ab833c0347",
    ]),
  );
});
