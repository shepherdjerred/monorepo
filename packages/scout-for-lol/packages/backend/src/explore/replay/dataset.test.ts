import { describe, expect, test } from "vitest";
import {
  StageDatasetPinSchema,
  datasetCoherenceIssues,
  datasetRepairHint,
  replayEnvironmentIssues,
  type DatasetCoherenceFacts,
  type StageDatasetPin,
} from "./dataset.ts";

const PIN: StageDatasetPin = StageDatasetPinSchema.parse({
  schemaVersion: 1,
  stage: "beta",
  createdAt: "2026-09-19T00:00:00.000Z",
  lake: {
    dir: "/data/stage-dataset/beta/report-lake",
    buildId: "build-123",
    puuidRemapFingerprint: "abc123",
    pulledAt: "2026-09-19T00:00:00.000Z",
    sourcePod: "scout-beta-0",
  },
  database: {
    name: "scout_beta_snapshot",
    url: "postgres://scout@127.0.0.1:5471/scout_beta_snapshot",
    pulledAt: "2026-09-19T00:05:00.000Z",
  },
  accountRows: { parquet: 100, database: 120 },
  verifiedAt: null,
  personas: {
    full: { requesterId: "1", guildIds: ["2"] },
  },
});

function facts(
  overrides: Partial<DatasetCoherenceFacts> = {},
): DatasetCoherenceFacts {
  return {
    // `in` rather than `??`: an explicitly-undefined fingerprint is the case
    // under test, and a nullish fallback would quietly restore the default.
    lakeFingerprint:
      "lakeFingerprint" in overrides ? overrides.lakeFingerprint : "abc123",
    databaseFingerprint: overrides.databaseFingerprint ?? "abc123",
    accountRows: overrides.accountRows ?? { parquet: 100, database: 120 },
    sampledPuuids: overrides.sampledPuuids ?? {
      checked: 25,
      missingFromDatabase: 0,
    },
  };
}

function environment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    DATABASE_URL: "postgres://scout@127.0.0.1:5471/scout_beta_snapshot",
    FEATURE_FLAGS_MODE: "disabled",
    ...overrides,
  };
}

describe("StageDatasetPinSchema", () => {
  test("rejects unknown fields rather than ignoring them", () => {
    expect(() =>
      StageDatasetPinSchema.parse({ ...PIN, somethingElse: true }),
    ).toThrow();
  });

  test("rejects a stage outside beta and prod", () => {
    expect(() =>
      StageDatasetPinSchema.parse({ ...PIN, stage: "staging" }),
    ).toThrow();
  });

  test("requires a persona to carry at least one guild", () => {
    expect(() =>
      StageDatasetPinSchema.parse({
        ...PIN,
        personas: { full: { requesterId: "1", guildIds: [] } },
      }),
    ).toThrow();
  });
});

describe("datasetCoherenceIssues", () => {
  test("accepts a matching pair", () => {
    expect(datasetCoherenceIssues(facts())).toEqual([]);
  });

  test("rejects a fingerprint mismatch — the silent identity-split case", () => {
    const issues = datasetCoherenceIssues(
      facts({ databaseFingerprint: "different" }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("PUUID remap fingerprint differs");
  });

  test("rejects a build that records no fingerprint at all", () => {
    const issues = datasetCoherenceIssues(
      facts({ lakeFingerprint: undefined }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("cannot be proven");
  });

  test("allows the database to hold more accounts than the lake", () => {
    // The lake is pulled first, so the database is the later of the two.
    expect(
      datasetCoherenceIssues(
        facts({ accountRows: { parquet: 100, database: 100_000 } }),
      ),
    ).toEqual([]);
  });

  test("rejects a lake holding more accounts than the database", () => {
    const issues = datasetCoherenceIssues(
      facts({ accountRows: { parquet: 200, database: 100 } }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("more accounts than the database");
  });

  test("rejects sampled lake PUUIDs the database has never heard of", () => {
    const issues = datasetCoherenceIssues(
      facts({ sampledPuuids: { checked: 25, missingFromDatabase: 3 } }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("3 of 25");
  });

  test("reports every failing check, not just the first", () => {
    expect(
      datasetCoherenceIssues(
        facts({
          databaseFingerprint: "different",
          accountRows: { parquet: 200, database: 100 },
          sampledPuuids: { checked: 25, missingFromDatabase: 3 },
        }),
      ),
    ).toHaveLength(3);
  });
});

describe("datasetRepairHint", () => {
  test("names the snapshot database and the stage bucket", () => {
    const hint = datasetRepairHint(PIN);
    expect(hint).toContain("scout_beta_snapshot");
    expect(hint).toContain("S3_BUCKET_NAME=scout-beta");
    expect(hint).toContain("compact:report-lake");
  });
});

describe("replayEnvironmentIssues", () => {
  const resolvedLakeDir = PIN.lake.dir;

  test("accepts an environment aimed at the pin", () => {
    expect(
      replayEnvironmentIssues({
        pin: PIN,
        environment: environment(),
        resolvedLakeDir,
      }),
    ).toEqual([]);
  });

  test("rejects a database that is not the pinned one", () => {
    const issues = replayEnvironmentIssues({
      pin: PIN,
      environment: environment({
        DATABASE_URL: "postgres://scout@127.0.0.1:5471/scout_dev_3000",
      }),
      resolvedLakeDir,
    });
    expect(issues).toEqual([expect.stringContaining("scout_dev_3000")]);
  });

  test("refuses a non-loopback database host", () => {
    const issues = replayEnvironmentIssues({
      pin: PIN,
      environment: environment({
        DATABASE_URL:
          "postgres://scout@scout-prod-postgresql.scout-prod:5432/scout_beta_snapshot",
      }),
      resolvedLakeDir,
    });
    expect(issues).toEqual([expect.stringContaining("is not loopback")]);
  });

  test("rejects a lake dir that is not the pinned one", () => {
    const issues = replayEnvironmentIssues({
      pin: PIN,
      environment: environment(),
      resolvedLakeDir: "/somewhere/else/report-lake",
    });
    expect(issues).toEqual([expect.stringContaining("/somewhere/else")]);
  });

  test("rejects a live Flipt, which would override the profile", () => {
    const issues = replayEnvironmentIssues({
      pin: PIN,
      environment: environment({ FEATURE_FLAGS_MODE: "flipt" }),
      resolvedLakeDir,
    });
    expect(issues).toEqual([expect.stringContaining("FEATURE_FLAGS_MODE")]);
  });

  test("rejects a reachable Temporal, which could start a workflow", () => {
    const issues = replayEnvironmentIssues({
      pin: PIN,
      environment: environment({ TEMPORAL_ADDRESS: "temporal:7233" }),
      resolvedLakeDir,
    });
    expect(issues).toEqual([expect.stringContaining("TEMPORAL_ADDRESS")]);
  });

  test("rejects a missing DATABASE_URL", () => {
    const issues = replayEnvironmentIssues({
      pin: PIN,
      environment: environment({ DATABASE_URL: undefined }),
      resolvedLakeDir,
    });
    expect(issues).toEqual([expect.stringContaining("DATABASE_URL is unset")]);
  });
});
