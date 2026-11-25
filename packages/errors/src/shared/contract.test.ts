import { describe, expect, it } from "vitest";
import {
  BugsinkImportRequestSchema,
  CreateProjectInputSchema,
  CreateTrackerIssueInputSchema,
  DEFAULT_PUBLIC_INGEST_HOST,
  IssueListQuerySchema,
  UpdateIssueStateInputSchema,
  buildProjectDsn,
} from "./contract.ts";

describe("errors shared wire contracts", () => {
  it("formats public DSNs on logging.sjer.red and custom origins", () => {
    expect(buildProjectDsn("337945d2208840dca4a573be311a1bbb", 1)).toBe(
      "https://337945d2208840dca4a573be311a1bbb@logging.sjer.red/1",
    );
    expect(
      buildProjectDsn(
        "b8bedd02e8cf416692a4b550ab76bfc1",
        17,
        "https://bugsink.sjer.red/extra?ignored=1",
      ),
    ).toBe("https://b8bedd02e8cf416692a4b550ab76bfc1@bugsink.sjer.red/17");
    expect(DEFAULT_PUBLIC_INGEST_HOST).toBe("https://logging.sjer.red");
  });

  it("applies defaults on query, project creation, Tracker triage, and import schemas", () => {
    expect(IssueListQuerySchema.parse({})).toEqual({
      sort: "last_seen",
      order: "desc",
      limit: 50,
    });
    expect(CreateProjectInputSchema.parse({ name: "  New App  " })).toEqual({
      name: "New App",
      alertOnNewIssue: true,
      alertOnRegression: true,
      retentionMaxEvents: 50,
    });
    expect(CreateTrackerIssueInputSchema.parse({})).toEqual({
      urgency: "medium",
      impact: "medium",
      effort: "s",
    });
    expect(BugsinkImportRequestSchema.parse({})).toEqual({
      dryRun: false,
      concurrency: 8,
    });
  });

  it("validates issue state transitions and rejects invalid slugs or limits", () => {
    expect(
      UpdateIssueStateInputSchema.parse({
        state: "RESOLVED_NEXT_RELEASE",
        resolvedInRelease: "1.2.3",
        expectedRevision: 3,
      }),
    ).toEqual({
      state: "RESOLVED_NEXT_RELEASE",
      resolvedInRelease: "1.2.3",
      expectedRevision: 3,
    });
    expect(() =>
      CreateProjectInputSchema.parse({
        name: "Bad",
        slug: "UPPERCASE SLUG!",
      }),
    ).toThrow();
    expect(() => IssueListQuerySchema.parse({ limit: 5000 })).toThrow();
  });
});
