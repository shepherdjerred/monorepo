import { describe, expect, it } from "vitest";
import { normalizeSentryEventPayload } from "#domain/envelope-normalize.ts";
import { runBugsinkImport } from "#infrastructure/bugsink-importer.ts";
import { behaviorConfig, BootstrapSchema } from "#infrastructure/config.ts";
import { createInMemoryErrorsRepository } from "#infrastructure/in-memory-db.ts";
import {
  createMailOutboxClient,
  dispatchPendingOutbox,
  renderOutboxAlertEmail,
} from "#infrastructure/mail-outbox.ts";
import { CANONICAL_PROJECTS } from "#infrastructure/seed-projects.ts";
import { createTrackerIssueClient } from "#infrastructure/tracker-client.ts";

describe("BootstrapSchema and behaviorConfig", () => {
  it("parses defaults and empty optional strings cleanly", async () => {
    const parsed = BootstrapSchema.parse({
      DATABASE_URL: "postgresql://errors:secret@127.0.0.1:5432/errors",
      ERRORS_INGEST_PORT: "",
      MAIL_API_URL: "",
      FEATURE_FLAGS_MODE: "disabled",
    });
    expect(parsed.PORT).toBe(7370);
    expect(parsed.ERRORS_INGEST_PORT).toBeUndefined();
    expect(parsed.MAIL_API_URL).toBeUndefined();
    expect(parsed.FEATURE_FLAGS_MODE).toBe("disabled");

    const cfg = behaviorConfig("production", true);
    expect(await cfg.value("ingestEnabled")).toBe(true);
    expect(await cfg.value("emailNotificationsEnabled")).toBe(true);
    expect(await cfg.value("trackerCreationEnabled")).toBe(true);
    expect(await cfg.value("telemetryEnabled")).toBe(true);
  });
});

const SHARED_IMPORTER_EVENT_DATA = {
  event_id: "evt_hex_001",
  level: "error",
  release: "2026.11.01",
  environment: "production",
  platform: "javascript",
  transaction: "/match",
  exception: {
    values: [
      {
        type: "TypeError",
        value: "Boom",
        stacktrace: {
          frames: [
            {
              filename: "src/match.ts",
              function: "loadMatch",
              lineno: 12,
              in_app: true,
            },
          ],
        },
      },
    ],
  },
};

function createImporterMockFetch(ids: {
  readonly issueOpenId: string;
  readonly issueResolvedId: string;
  readonly event1Uuid: string;
  readonly event2Uuid: string;
}) {
  return (input: string | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const jsonResponse = (body: unknown) =>
      Promise.resolve(Response.json(body, { status: 200 }));
    if (url === "https://bugsink.sjer.red/api/canonical/0/projects/") {
      return jsonResponse({
        next: null,
        results: [
          {
            id: 1,
            slug: "scout-for-lol",
            name: "Scout for LoL",
            dsn: "https://337945d2208840dca4a573be311a1bbb@bugsink.sjer.red/1",
            digested_event_count: 15,
            stored_event_count: 2,
            alert_on_new_issue: true,
            alert_on_regression: true,
          },
        ],
      });
    }
    if (
      url === "https://bugsink.sjer.red/api/canonical/0/releases/?project=1"
    ) {
      return jsonResponse({
        next: null,
        results: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            project: 1,
            version: "2026.11.01",
            date_released: "2026-11-01T00:00:00Z",
          },
          {
            id: "55555555-5555-4555-8555-555555555556",
            project: 1,
            version: "",
            date_released: null,
          },
        ],
      });
    }
    if (url === "https://bugsink.sjer.red/api/canonical/0/issues/?project=1") {
      return jsonResponse({
        next: null,
        results: [
          {
            id: ids.issueResolvedId,
            project: 1,
            first_seen: "2026-10-01T00:00:00Z",
            last_seen: "2026-10-05T00:00:00Z",
            digested_event_count: 5,
            stored_event_count: 1,
            calculated_type: "TypeError",
            calculated_value: "Boom",
            transaction: "/match",
            is_resolved: true,
            is_resolved_by_next_release: false,
            is_muted: false,
          },
          {
            id: ids.issueOpenId,
            project: 1,
            first_seen: "2026-11-01T00:00:00Z",
            last_seen: "2026-11-20T00:00:00Z",
            digested_event_count: 10,
            stored_event_count: 1,
            calculated_type: "TypeError",
            calculated_value: "Boom",
            transaction: "/match",
            is_resolved: false,
            is_resolved_by_next_release: false,
            is_muted: false,
          },
        ],
      });
    }
    if (
      url ===
      `https://bugsink.sjer.red/api/canonical/0/events/?issue=${ids.issueResolvedId}`
    ) {
      return jsonResponse({
        next: null,
        results: [
          {
            id: ids.event1Uuid,
            event_id: "evt_resolved_1",
            issue: ids.issueResolvedId,
            project: 1,
            timestamp: "2026-10-05T00:00:00Z",
          },
        ],
      });
    }
    if (
      url ===
      `https://bugsink.sjer.red/api/canonical/0/events/?issue=${ids.issueOpenId}`
    ) {
      return jsonResponse({
        next: null,
        results: [
          {
            id: ids.event2Uuid,
            event_id: "evt_open_2",
            issue: ids.issueOpenId,
            project: 1,
            timestamp: "2026-11-20T00:00:00Z",
          },
        ],
      });
    }
    if (
      url ===
      `https://bugsink.sjer.red/api/canonical/0/events/${ids.event1Uuid}/`
    ) {
      return jsonResponse({
        id: ids.event1Uuid,
        event_id: "evt_resolved_1",
        issue: ids.issueResolvedId,
        project: 1,
        timestamp: "2026-10-05T00:00:00Z",
        data: { ...SHARED_IMPORTER_EVENT_DATA, event_id: "evt_resolved_1" },
        stacktrace_md: "# TypeError\nBoom\n",
      });
    }
    if (
      url ===
      `https://bugsink.sjer.red/api/canonical/0/events/${ids.event2Uuid}/`
    ) {
      return jsonResponse({
        id: ids.event2Uuid,
        event_id: "evt_open_2",
        issue: ids.issueOpenId,
        project: 1,
        timestamp: "2026-11-20T00:00:00Z",
        data: { ...SHARED_IMPORTER_EVENT_DATA, event_id: "evt_open_2" },
        stacktrace_md: "",
      });
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  };
}

describe("Bugsink importer", () => {
  it("imports projects, releases, issues, and events with delta sync and zero outbox emails", async () => {
    const repo = createInMemoryErrorsRepository();
    const issueOpenId = "11111111-1111-4111-8111-111111111111";
    const issueResolvedId = "22222222-2222-4222-8222-222222222222";
    const event1Uuid = "33333333-3333-4333-8333-333333333333";
    const event2Uuid = "44444444-4444-4444-8444-444444444444";
    const mockFetch = createImporterMockFetch({
      issueOpenId,
      issueResolvedId,
      event1Uuid,
      event2Uuid,
    });

    const firstRun = await runBugsinkImport({
      baseUrl: "https://bugsink.sjer.red",
      token: "test-bugsink-token",
      repo,
      fetchFn: mockFetch,
    });
    expect(firstRun.projectsImported).toBe(1);
    expect(firstRun.releasesImported).toBe(1);
    expect(firstRun.issuesImported).toBe(2);
    expect(firstRun.eventsImported).toBe(2);
    expect(firstRun.eventsSkippedExisting).toBe(0);

    // Zero notification outbox rows queued by import!
    const claimedAfterImport = await repo.claimPendingOutbox(10);
    expect(claimedAfterImport).toHaveLength(0);

    // Second run skips already imported events (delta sync)
    const secondRun = await runBugsinkImport({
      baseUrl: "https://bugsink.sjer.red",
      token: "test-bugsink-token",
      repo,
      fetchFn: mockFetch,
    });
    expect(secondRun.eventsImported).toBe(0);
    expect(secondRun.eventsSkippedExisting).toBe(2);

    // Shared normalized fingerprint must route new live events to the OPEN issue!
    const liveIngest = await repo.ingestEvent({
      projectId: 1,
      publicKey: CANONICAL_PROJECTS[0]?.publicKey ?? "",
      normalizedEvent: normalizeSentryEventPayload({
        ...SHARED_IMPORTER_EVENT_DATA,
        event_id: "evt_live_3",
      }),
    });
    expect(liveIngest).toMatchObject({
      status: "accepted",
      issueId: issueOpenId,
      isNewIssue: false,
    });
  });
});

describe("Outbound mail outbox and Tracker tRPC client", () => {
  it("dispatches outbox emails and retries failures with exponential backoff", async () => {
    const repo = createInMemoryErrorsRepository();
    await repo.seedCanonicalProjects();
    const scoutKey = CANONICAL_PROJECTS[0]?.publicKey ?? "";

    await repo.ingestEvent({
      projectId: 1,
      publicKey: scoutKey,
      normalizedEvent: normalizeSentryEventPayload({
        event_id: "evt_mail_1",
        exception: { values: [{ type: "Error", value: "DB timeout" }] },
      }),
    });

    let shouldFail = true;
    const sentPayloads: string[] = [];
    const mail = createMailOutboxClient({
      baseUrl: "http://mail.mail.svc.cluster.local:7371",
      token: "mail-api-token",
      from: "Errors <errors@sjer.red>",
      to: "alerts@sjer.red",
      fetchFn: (_url, init) => {
        if (shouldFail) {
          return Promise.resolve(
            new Response("temporary outage", { status: 502 }),
          );
        }
        if (typeof init?.body === "string") {
          sentPayloads.push(init.body);
        }
        return Promise.resolve(
          Response.json(
            {
              id: "msg-1",
              rfcMessageId: "<msg-1@sjer.red>",
              status: "queued",
              deduplicated: false,
            },
            { status: 200 },
          ),
        );
      },
    });

    const t0 = new Date();
    const firstAttempt = await dispatchPendingOutbox({
      repo,
      mail,
      consolePublicOrigin: "https://errors.tailnet-1a49.ts.net",
      emailNotificationsEnabled: () => Promise.resolve(true),
      now: t0,
    });
    expect(firstAttempt).toEqual({ claimed: 1, sent: 0, failed: 1 });

    // Before backoff elapses, nothing is claimed
    const tooEarly = await dispatchPendingOutbox({
      repo,
      mail,
      consolePublicOrigin: "https://errors.tailnet-1a49.ts.net",
      emailNotificationsEnabled: () => Promise.resolve(true),
      now: new Date(t0.getTime() + 5000),
    });
    expect(tooEarly.claimed).toBe(0);

    // After 35s backoff, retry succeeds
    shouldFail = false;
    const retryResult = await dispatchPendingOutbox({
      repo,
      mail,
      consolePublicOrigin: "https://errors.tailnet-1a49.ts.net",
      emailNotificationsEnabled: () => Promise.resolve(true),
      now: new Date(t0.getTime() + 35_000),
    });
    expect(retryResult).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(sentPayloads[0]).toContain(
      "[Errors] New issue in Scout for LoL: Error",
    );
  });

  it("creates Tracker AI issues over tRPC HTTP", async () => {
    let capturedBody = "";
    const tracker = createTrackerIssueClient({
      apiUrl: "http://tracker.tracker.svc.cluster.local:7351",
      publicUrl: "https://tracker.tailnet-1a49.ts.net",
      fetchFn: (_url, init) => {
        if (typeof init?.body === "string") {
          capturedBody = init.body;
        }
        return Promise.resolve(
          Response.json(
            { result: { data: { identifier: "AI-599" } } },
            { status: 200 },
          ),
        );
      },
    });

    const created = await tracker.createIssue({
      title: "Scout for LoL: TypeError: Boom",
      description: "# TypeError\nBoom",
      urgency: "high",
      impact: "medium",
      effort: "s",
    });
    expect(created).toEqual({
      identifier: "AI-599",
      url: "https://tracker.tailnet-1a49.ts.net/AI/issues/AI-599",
    });
    expect(capturedBody).toContain('"teamKey":"AI"');
    expect(capturedBody).toContain('"key":"service:errors"');
  });
});

describe("renderOutboxAlertEmail", () => {
  const item = {
    id: "1",
    issueId: "iss-1",
    eventId: "evt-1",
    kind: "REGRESSION" as const,
    messageId: "msg-1",
    attempts: 0,
    projectSlug: "scout",
    projectName: "Scout <API>",
    issueType: "TypeError",
    issueValue: "boom",
    transaction: "POST /x",
    release: "r1",
    environment: null,
    stacktraceMd: "TypeError: boom\n    at fn (a.ts:1:1)",
  };

  it("renders the shared email layout with escaped content and an intact plain body", () => {
    const email = renderOutboxAlertEmail(item, "https://errors.example/");
    expect(email.subject).toBe("[Errors] Regression in Scout <API>: TypeError");
    expect(email.htmlBody).toContain("<!DOCTYPE html>");
    expect(email.htmlBody).toContain("Regression in Scout &lt;API&gt;");
    expect(email.htmlBody).toContain(
      'href="https://errors.example/issues/iss-1"',
    );
    expect(email.htmlBody).toContain("Stack trace");
    expect(email.htmlBody).toContain("at fn (a.ts:1:1)");
    expect(email.htmlBody).toContain("POST /x");
    expect(email.htmlBody).not.toContain("Environment");
    expect(email.htmlBody).not.toContain("text-transform");
    expect(email.plainBody).toContain("Project: Scout <API> (scout)");
    expect(email.plainBody).toContain(
      "Issue URL: https://errors.example/issues/iss-1",
    );
    expect(email.tag).toBe("errors-regression");
  });
});
