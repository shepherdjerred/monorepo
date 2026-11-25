import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  createEmptyTestDatabase,
  ensureSharedPostgres,
  envWithPostgresBin,
  runCommandAsync,
  type OwnedTestDatabaseHandle,
} from "@shepherdjerred/test-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeSentryEventPayload } from "#domain/envelope-normalize.ts";
import { PrismaClient } from "#generated/prisma/client.ts";
import {
  runBugsinkImport,
  type FetchLike,
} from "#infrastructure/bugsink-importer.ts";
import { createPrismaErrorsRepository } from "#infrastructure/db.ts";
import type { ErrorsRepository } from "#infrastructure/repository-types.ts";
import { CANONICAL_PROJECTS } from "#infrastructure/seed-projects.ts";
import { createAdminApp } from "#server/admin-app.ts";
import {
  OverviewResponseSchema,
  type ProjectSummary,
} from "#shared/contract.ts";

const packageRoot = path.resolve(import.meta.dir, "../..");

let dbHandle: OwnedTestDatabaseHandle | undefined;
let databaseUrl = "";
let prisma: PrismaClient | undefined;

beforeAll(async () => {
  const shared = ensureSharedPostgres();
  dbHandle = await createEmptyTestDatabase({
    prefix: "tracker",
    kind: "test",
    adminUrl: shared.superUrl,
  });
  databaseUrl = dbHandle.url;

  const migrate = await runCommandAsync(["bun", "run", "migrate:deploy"], {
    cwd: packageRoot,
    env: envWithPostgresBin({ DATABASE_URL: databaseUrl }),
  });
  if (migrate.exitCode !== 0) {
    throw new Error(
      `errors prisma migrate deploy failed: ${migrate.stderr || migrate.stdout}`,
    );
  }

  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
});

afterAll(async () => {
  if (prisma !== undefined) {
    await prisma.$disconnect();
  }
  if (dbHandle !== undefined) {
    await dbHandle.drop();
  }
});

async function verifySeedRetentionAndOutbox(repo: ErrorsRepository): Promise<{
  readonly customProject: ProjectSummary;
  readonly issueId: string;
}> {
  const firstSeed = await repo.seedCanonicalProjects();
  expect(firstSeed).toBe(15);

  const secondSeed = await repo.seedCanonicalProjects();
  expect(secondSeed).toBe(0);

  const customProject = await repo.createProject({
    name: "Custom Sandbox Service",
    alertOnNewIssue: true,
    alertOnRegression: true,
    retentionMaxEvents: 3,
  });
  expect(customProject.id).toBeGreaterThanOrEqual(100);

  let issueId = "";
  for (let idx = 1; idx <= 5; idx += 1) {
    const outcome = await repo.ingestEvent({
      projectId: customProject.id,
      publicKey: customProject.publicKey,
      normalizedEvent: normalizeSentryEventPayload({
        event_id: `pg_evt_${String(idx)}`,
        timestamp: new Date(1_732_500_000_000 + idx * 1000).toISOString(),
        release: "2026.11.25",
        exception: {
          values: [
            {
              type: "ReferenceError",
              value: "foo is not defined",
              stacktrace: {
                frames: [
                  {
                    filename: "src/worker.ts",
                    function: "runJob",
                    lineno: 10 + idx,
                    in_app: true,
                  },
                ],
              },
            },
          ],
        },
      }),
    });
    expect(outcome.status).toBe("accepted");
    if (outcome.status === "accepted") {
      issueId = outcome.issueId;
    }
  }

  const dup = await repo.ingestEvent({
    projectId: customProject.id,
    publicKey: customProject.publicKey,
    normalizedEvent: normalizeSentryEventPayload({
      event_id: "pg_evt_5",
      exception: {
        values: [{ type: "ReferenceError", value: "foo is not defined" }],
      },
    }),
  });
  expect(dup.status).toBe("duplicate");

  const updatedProject = await repo.getProject(customProject.id);
  expect(updatedProject?.digestedEventCount).toBe(5);
  expect(updatedProject?.storedEventCount).toBe(3);

  const issueDetail = await repo.getIssue(issueId);
  expect(issueDetail?.digestedEventCount).toBe(5);
  expect(issueDetail?.storedEventCount).toBe(3);

  const storedEvents = await repo.listEvents(issueId);
  expect(storedEvents?.items.map((e) => e.eventId)).toEqual([
    "pg_evt_5",
    "pg_evt_4",
    "pg_evt_3",
  ]);

  const t0 = new Date();
  const firstClaim = await repo.claimPendingOutbox(10, t0);
  expect(firstClaim).toHaveLength(1);
  expect(firstClaim[0]?.kind).toBe("NEW_ISSUE");

  const concurrentClaim = await repo.claimPendingOutbox(10, t0);
  expect(concurrentClaim).toHaveLength(0);

  const claimedId = firstClaim[0]?.id ?? "";
  await repo.completeOutbox(claimedId, t0);

  return { customProject, issueId };
}

async function verifyNextReleaseRegression(
  repo: ErrorsRepository,
  customProject: ProjectSummary,
  issueId: string,
): Promise<void> {
  await repo.updateIssueState(issueId, {
    state: "RESOLVED_NEXT_RELEASE",
  });

  await repo.ingestEvent({
    projectId: customProject.id,
    publicKey: customProject.publicKey,
    normalizedEvent: normalizeSentryEventPayload({
      event_id: "pg_evt_same_rel",
      timestamp: new Date(1_732_502_000_000).toISOString(),
      release: "2026.11.25",
      exception: {
        values: [
          {
            type: "ReferenceError",
            value: "foo is not defined",
            stacktrace: {
              frames: [
                {
                  filename: "src/worker.ts",
                  function: "runJob",
                  lineno: 99,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    }),
  });
  const sameReleaseIssue = await repo.getIssue(issueId);
  expect(sameReleaseIssue?.state).toBe("RESOLVED_NEXT_RELEASE");

  await repo.ingestEvent({
    projectId: customProject.id,
    publicKey: customProject.publicKey,
    normalizedEvent: normalizeSentryEventPayload({
      event_id: "pg_evt_new_rel",
      timestamp: new Date(1_732_505_000_000).toISOString(),
      release: "2026.11.26",
      exception: {
        values: [
          {
            type: "ReferenceError",
            value: "foo is not defined",
            stacktrace: {
              frames: [
                {
                  filename: "src/worker.ts",
                  function: "runJob",
                  lineno: 99,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    }),
  });
  const regressedIssue = await repo.getIssue(issueId);
  expect(regressedIssue?.state).toBe("OPEN");
  expect(regressedIssue?.regressedCount).toBe(1);
}

function createPgBugsinkMockFetch(options: {
  readonly scoutKey: string;
  readonly importedIssueUuid: string;
  readonly importedEventUuid: string;
}): FetchLike {
  const { scoutKey, importedIssueUuid, importedEventUuid } = options;
  return (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const ok = (body: unknown) =>
      Promise.resolve(Response.json(body, { status: 200 }));
    if (url.endsWith("/projects/")) {
      return ok({
        next: null,
        results: [
          {
            id: 1,
            slug: "scout-for-lol",
            name: "Scout for LoL",
            dsn: `https://${scoutKey}@bugsink.sjer.red/1`,
            digested_event_count: 8,
            stored_event_count: 1,
          },
        ],
      });
    }
    if (url.includes("/releases/?project=1")) {
      return ok({ next: null, results: [] });
    }
    if (url.includes("/issues/?project=1")) {
      return ok({
        next: null,
        results: [
          {
            id: importedIssueUuid,
            project: 1,
            first_seen: "2026-11-10T00:00:00Z",
            last_seen: "2026-11-22T00:00:00Z",
            digested_event_count: 8,
            stored_event_count: 1,
            calculated_type: "SyntaxError",
            calculated_value: "Unexpected token",
            transaction: "/parse",
            is_resolved: false,
            is_resolved_by_next_release: false,
            is_muted: false,
          },
        ],
      });
    }
    if (url.includes(`/events/?issue=${importedIssueUuid}`)) {
      return ok({
        next: null,
        results: [
          {
            id: importedEventUuid,
            event_id: "imported_evt_pg_1",
            issue: importedIssueUuid,
            project: 1,
            timestamp: "2026-11-22T00:00:00Z",
          },
        ],
      });
    }
    if (url.endsWith(`/events/${importedEventUuid}/`)) {
      return ok({
        id: importedEventUuid,
        event_id: "imported_evt_pg_1",
        issue: importedIssueUuid,
        project: 1,
        timestamp: "2026-11-22T00:00:00Z",
        data: {
          event_id: "imported_evt_pg_1",
          exception: {
            values: [{ type: "SyntaxError", value: "Unexpected token" }],
          },
        },
        stacktrace_md: "# SyntaxError\nUnexpected token\n",
      });
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
}

describe("errors PostgreSQL 18 integration", () => {
  it("seeds canonical projects idempotently, allocates new project IDs >= 100, prunes overflow events, locks outbox, and imports Bugsink history", async () => {
    if (prisma === undefined) {
      throw new Error("Prisma client was not initialized");
    }
    const repo = createPrismaErrorsRepository(prisma);
    const { customProject, issueId } = await verifySeedRetentionAndOutbox(repo);
    await verifyNextReleaseRegression(repo, customProject, issueId);

    const importedIssueUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const importedEventUuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const scoutKey = CANONICAL_PROJECTS[0]?.publicKey ?? "";

    const importResult = await runBugsinkImport({
      baseUrl: "https://bugsink.sjer.red",
      token: "pg-import-token",
      repo,
      projectId: 1,
      fetchFn: createPgBugsinkMockFetch({
        scoutKey,
        importedIssueUuid,
        importedEventUuid,
      }),
    });
    expect(importResult.issuesImported).toBe(1);
    expect(importResult.eventsImported).toBe(1);

    const app = createAdminApp({
      repo,
      trackerClient: null,
      trackerCreationEnabled: () => Promise.resolve(true),
    });
    const overviewRes = await app.request(
      "http://errors.local/api/v1/overview",
    );
    expect(overviewRes.status).toBe(200);
    const overview = OverviewResponseSchema.parse(await overviewRes.json());
    expect(overview.totalUnresolved).toBe(2);
  });
});
