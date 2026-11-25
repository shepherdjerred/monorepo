import { tmpdir } from "node:os";
import path from "node:path";
import * as Sentry from "@sentry/bun";
import { bugsinkServerOptions } from "@shepherdjerred/bugsink-config/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createInMemoryErrorsRepository } from "#infrastructure/in-memory-db.ts";
import { CANONICAL_PROJECTS } from "#infrastructure/seed-projects.ts";
import { createErrorsMetrics } from "#infrastructure/telemetry.ts";
import { createAdminApp } from "#server/admin-app.ts";
import { createIngestApp } from "#server/ingest-app.ts";
import {
  BulkUpdateIssuesResponseSchema,
  CreateTrackerIssueResponseSchema,
  EventDetailSchema,
  IssueDetailSchema,
  IssueListResponseSchema,
  OpsSummaryResponseSchema,
  OverviewResponseSchema,
  ProjectSummarySchema,
  ReleaseItemSchema,
} from "#shared/contract.ts";

const StacktraceJsonSchema = z.object({
  id: z.uuid(),
  eventId: z.string(),
  issueId: z.uuid(),
  stacktraceMd: z.string(),
});

async function setupHarness(options?: {
  readonly machineToken?: string | undefined;
  readonly clientRoot?: string | undefined;
}) {
  const repo = createInMemoryErrorsRepository();
  await repo.seedCanonicalProjects();
  let ticketSeq = 700;
  const metrics = createErrorsMetrics();

  const adminApp = createAdminApp({
    repo,
    metrics,
    machineToken: options?.machineToken,
    clientRoot: options?.clientRoot,
    trackerCreationEnabled: () => Promise.resolve(true),
    trackerClient: {
      issueUrlForIdentifier: (id) =>
        `https://tracker.tailnet-1a49.ts.net/AI/issues/${id}`,
      createIssue: () => {
        ticketSeq += 1;
        const identifier = `AI-${String(ticketSeq)}`;
        return Promise.resolve({
          identifier,
          url: `https://tracker.tailnet-1a49.ts.net/AI/issues/${identifier}`,
        });
      },
    },
  });

  const ingestApp = createIngestApp({ repo, metrics });
  return { repo, adminApp, ingestApp, metrics };
}

describe("ingest-app and admin-app HTTP surfaces", () => {
  it("isolates public ingest-app to /healthz and /api/:projectId/envelope(/)", async () => {
    const { ingestApp } = await setupHarness();

    const health = await ingestApp.request("http://ingest.local/healthz");
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");

    const preflight = await ingestApp.request(
      "http://ingest.local/api/1/envelope/",
      { method: "OPTIONS" },
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");

    for (const blockedPath of [
      "/",
      "/readyz",
      "/metrics",
      "/api/v1/overview",
      "/api/v1/issues",
      "/api/v1/admin/import-bugsink",
    ]) {
      const res = await ingestApp.request(`http://ingest.local${blockedPath}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  it("ingests real @sentry/bun v11 captureException and captureMessage envelopes via bugsinkServerOptions", async () => {
    const { adminApp, ingestApp } = await setupHarness();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: ingestApp.fetch,
    });

    try {
      const scoutKey = CANONICAL_PROJECTS[0]?.publicKey ?? "";
      const dsn = `http://${scoutKey}@127.0.0.1:${String(server.port)}/1`;
      const sentryEnv: Record<string, string | undefined> = {};

      Sentry.init({
        ...bugsinkServerOptions({
          dsn,
          environment: "test",
          release: "2026.11.25-sdk",
          env: sentryEnv,
        }),
        enableOpenTelemetrySetup: false,
      });

      Sentry.captureException(new TypeError("SDK real transport crash"));
      Sentry.captureMessage("SDK standalone warning notice", "warning");
      const flushed = await Sentry.flush(5000);
      expect(flushed).toBe(true);
      await Sentry.close(2000);

      const overviewRes = await adminApp.request(
        "http://errors.local/api/v1/overview",
        {
          headers: {
            "Tailscale-User-Login": "jerred@sjer.red",
            "Tailscale-User-Name": "Jerred Shepherd",
          },
        },
      );
      expect(overviewRes.status).toBe(200);
      const overview = OverviewResponseSchema.parse(await overviewRes.json());
      expect(overview.viewer.login).toBe("jerred@sjer.red");
      expect(overview.totalUnresolved).toBe(2);
      expect(overview.totalDigestedEvents).toBe(2);

      const issuesRes = await adminApp.request(
        "http://errors.local/api/v1/issues?project=scout-for-lol",
      );
      const issues = IssueListResponseSchema.parse(await issuesRes.json());
      expect(issues.items).toHaveLength(2);

      const crashIssue = issues.items.find((i) => i.type === "TypeError");
      expect(crashIssue?.value).toContain("SDK real transport crash");
      expect(crashIssue?.lastRelease).toBe("2026.11.25-sdk");

      if (crashIssue === undefined) {
        throw new Error("Expected TypeError issue from @sentry/bun");
      }

      const issueDetailRes = await adminApp.request(
        `http://errors.local/api/v1/issues/${crashIssue.id}`,
      );
      const issueDetail = IssueDetailSchema.parse(await issueDetailRes.json());
      expect(issueDetail.latestEvent).not.toBeNull();
      const eventId = issueDetail.latestEvent?.id ?? "";

      const eventDetailRes = await adminApp.request(
        `http://errors.local/api/v1/events/${eventId}`,
      );
      const eventDetail = EventDetailSchema.parse(await eventDetailRes.json());
      expect(eventDetail.exceptions[0]?.type).toBe("TypeError");

      const mdRes = await adminApp.request(
        `http://errors.local/api/v1/events/${eventId}/stacktrace`,
      );
      expect(mdRes.headers.get("Content-Type")).toContain("text/markdown");
      expect(await mdRes.text()).toContain("# TypeError");

      const jsonMdRes = await adminApp.request(
        `http://errors.local/api/v1/events/${eventId}/stacktrace?format=json`,
      );
      const jsonMd = StacktraceJsonSchema.parse(await jsonMdRes.json());
      expect(jsonMd.stacktraceMd).toContain("SDK real transport crash");

      const metricsRes = await adminApp.request("http://errors.local/metrics");
      const metricsText = await metricsRes.text();
      expect(metricsText).toContain(
        'bugsink_issues_unresolved{project="scout-for-lol",service="errors"} 2',
      );
      expect(metricsText).toContain(
        'bugsink_project_digested_events{project="scout-for-lol",service="errors"} 2',
      );

      const opsRes = await adminApp.request(
        "http://errors.local/api/v1/ops-summary",
      );
      const ops = OpsSummaryResponseSchema.parse(await opsRes.json());
      expect(ops.totalUnresolved).toBe(2);
    } finally {
      await server.stop();
    }
  });
});

describe("admin-app auth, mutations, and static serving", () => {
  it("enforces Tailscale or Bearer auth on mutations, revision conflicts, idempotent Tracker creation, redirects, and SPA static files", async () => {
    const tempDir = path.join(tmpdir(), `errors-spa-${crypto.randomUUID()}`);
    await Bun.write(
      path.join(tempDir, "index.html"),
      '<!doctype html><html><body><div id="root">spa</div></body></html>',
    );
    await Bun.write(
      path.join(tempDir, "assets/app-123.js"),
      "console.warn('bundle');",
    );

    const { adminApp, ingestApp } = await setupHarness({
      machineToken: "machine-secret-token-for-test-suite",
      clientRoot: tempDir,
    });

    // Ingest one event into scout-for-lol
    const scoutKey = CANONICAL_PROJECTS[0]?.publicKey ?? "";
    const envelope = [
      JSON.stringify({ dsn: `https://${scoutKey}@logging.sjer.red/1` }),
      JSON.stringify({ type: "event" }),
      JSON.stringify({
        event_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        release: "1.4.0",
        exception: { values: [{ type: "Error", value: "Auth test crash" }] },
      }),
    ].join("\n");
    const ingRes = await ingestApp.request(
      "http://ingest.local/api/1/envelope",
      {
        method: "POST",
        body: envelope,
      },
    );
    expect(ingRes.status).toBe(200);

    // Unauthenticated mutation rejected with 401 when ERRORS_MACHINE_TOKEN is set
    const unauthCreate = await adminApp.request(
      "http://errors.local/api/v1/projects",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Blocked Project" }),
      },
    );
    expect(unauthCreate.status).toBe(401);

    // Bearer token authorized
    const bearerCreate = await adminApp.request(
      "http://errors.local/api/v1/projects",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer machine-secret-token-for-test-suite",
        },
        body: JSON.stringify({ name: "New Service" }),
      },
    );
    expect(bearerCreate.status).toBe(201);
    const createdProj = ProjectSummarySchema.parse(await bearerCreate.json());
    expect(createdProj.id).toBeGreaterThanOrEqual(100);

    // Tailscale header authorized for state transitions + optimistic concurrency
    const listRes = await adminApp.request("http://errors.local/api/v1/issues");
    const issue = IssueListResponseSchema.parse(await listRes.json()).items[0];
    if (issue === undefined) {
      throw new Error("Expected ingested issue");
    }

    const patchNextRel = await adminApp.request(
      `http://errors.local/api/v1/issues/${issue.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Tailscale-User-Login": "jerred@sjer.red",
        },
        body: JSON.stringify({
          state: "RESOLVED_NEXT_RELEASE",
          expectedRevision: issue.revision,
        }),
      },
    );
    expect(patchNextRel.status).toBe(200);
    const patchedDetail = IssueDetailSchema.parse(await patchNextRel.json());
    expect(patchedDetail.resolvedInRelease).toBe("1.4.0");

    const stalePatch = await adminApp.request(
      `http://errors.local/api/v1/issues/${issue.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Tailscale-User-Login": "jerred@sjer.red",
        },
        body: JSON.stringify({
          state: "MUTED",
          expectedRevision: issue.revision,
        }),
      },
    );
    expect(stalePatch.status).toBe(409);

    const bulkRes = await adminApp.request(
      "http://errors.local/api/v1/issues/bulk-update",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Tailscale-User-Login": "jerred@sjer.red",
        },
        body: JSON.stringify({ ids: [issue.id], state: "OPEN" }),
      },
    );
    expect(
      BulkUpdateIssuesResponseSchema.parse(await bulkRes.json()).updatedCount,
    ).toBe(1);

    // Tracker issue creation is idempotent on repeat calls
    const trackerFirst = await adminApp.request(
      `http://errors.local/api/v1/issues/${issue.id}/tracker-issue`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Tailscale-User-Login": "jerred@sjer.red",
        },
        body: JSON.stringify({ urgency: "high", impact: "high", effort: "s" }),
      },
    );
    expect(trackerFirst.status).toBe(201);
    const firstLink = CreateTrackerIssueResponseSchema.parse(
      await trackerFirst.json(),
    );
    expect(firstLink.created).toBe(true);

    const trackerSecond = await adminApp.request(
      `http://errors.local/api/v1/issues/${issue.id}/tracker-issue`,
      {
        method: "POST",
        headers: { "Tailscale-User-Login": "jerred@sjer.red" },
      },
    );
    expect(trackerSecond.status).toBe(200);
    const secondLink = CreateTrackerIssueResponseSchema.parse(
      await trackerSecond.json(),
    );
    expect(secondLink.created).toBe(false);
    expect(secondLink.trackerIssueIdentifier).toBe(
      firstLink.trackerIssueIdentifier,
    );

    // Releases endpoint
    const relCreate = await adminApp.request(
      "http://errors.local/api/v1/releases",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Tailscale-User-Login": "jerred@sjer.red",
        },
        body: JSON.stringify({ project: "scout-for-lol", version: "1.5.0" }),
      },
    );
    expect(relCreate.status).toBe(201);
    expect(ReleaseItemSchema.parse(await relCreate.json()).version).toBe(
      "1.5.0",
    );

    // Legacy Bugsink 301 redirects
    const legacyIssueRedirect = await adminApp.request(
      `http://errors.local/issues/issue/${issue.id}/event/last/`,
    );
    expect(legacyIssueRedirect.status).toBe(301);
    expect(legacyIssueRedirect.headers.get("Location")).toBe(
      `/issues/${issue.id}`,
    );

    const legacyProjectRedirect = await adminApp.request(
      "http://errors.local/issues/1/",
    );
    expect(legacyProjectRedirect.status).toBe(301);
    expect(legacyProjectRedirect.headers.get("Location")).toBe(
      "/projects/scout-for-lol",
    );

    // Static assets & SPA fallback
    const assetOk = await adminApp.request(
      "http://errors.local/assets/app-123.js",
    );
    expect(assetOk.status).toBe(200);
    expect(assetOk.headers.get("Cache-Control")).toContain("immutable");

    const assetMissing = await adminApp.request(
      "http://errors.local/assets/missing.js",
    );
    expect(assetMissing.status).toBe(404);

    const spaRoute = await adminApp.request(
      `http://errors.local/issues/${issue.id}`,
    );
    expect(spaRoute.status).toBe(200);
    expect(await spaRoute.text()).toContain('<div id="root">spa</div>');
  });
});
