import { afterEach, describe, expect, test } from "vitest";
import { requiredCredentialsFor } from "#lib/credential-commands.ts";
import {
  createTrackerIssue,
  getEvent,
  getEventStacktrace,
  getEventStacktraceJson,
  getIssue,
  getIssueEvents,
  getIssues,
  getOverview,
  getProject,
  getProjects,
  getReleases,
  importBugsink,
  updateIssuesState,
} from "#lib/errors/client.ts";
import { buildErrorsApiUrl, errorsBaseUrl } from "#lib/errors/http.ts";
import {
  ORIGINAL_ERRORS_FETCH,
  restoreErrorsTestEnvironment,
} from "./test-env.ts";

const ISSUE_ID_1 = "11111111-1111-4111-8111-111111111111";
const ISSUE_ID_2 = "22222222-2222-4222-8222-222222222222";
const EVENT_UUID_1 = "33333333-3333-4333-8333-333333333333";
const EVENT_UUID_2 = "44444444-4444-4444-8444-444444444444";
const RELEASE_UUID_1 = "55555555-5555-4555-8555-555555555555";

type RecordedRequest = {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly bodyText: string | null;
};

function installFetchMock(
  handler: (req: RecordedRequest) => Promise<Response> | Response,
): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  const fetchMock: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const bodyText = typeof init?.body === "string" ? init.body : null;
      const entry: RecordedRequest = { url, method, headers, bodyText };
      recorded.push(entry);
      return handler(entry);
    },
    { preconnect: ORIGINAL_ERRORS_FETCH.preconnect },
  );
  globalThis.fetch = fetchMock;
  return recorded;
}

function makeProject(id = 1, slug = "scout-for-lol") {
  return {
    id,
    slug,
    name: "Scout",
    publicKey: "pub_key_123",
    dsn: `https://pub_key_123@logging.sjer.red/${String(id)}`,
    legacyDsn: `https://pub_key_123@bugsink.sjer.red/${String(id)}`,
    digestedEventCount: 12,
    storedEventCount: 5,
    unresolvedCount: 2,
    regressedCount: 1,
    mutedCount: 0,
    activeIssues7d: 2,
    alertOnNewIssue: true,
    alertOnRegression: true,
    retentionMaxEvents: 50,
    createdAt: "2026-11-24T00:00:00.000Z",
  };
}

function makeIssue(
  id = ISSUE_ID_1,
  state: "OPEN" | "RESOLVED" | "RESOLVED_NEXT_RELEASE" | "MUTED" = "OPEN",
) {
  return {
    id,
    projectId: 1,
    projectSlug: "scout-for-lol",
    projectName: "Scout",
    primaryFingerprint: "fp-1",
    type: "TypeError",
    value: "Cannot read properties of undefined",
    transaction: "GET /api/matches",
    level: "error",
    state,
    resolvedInRelease: null,
    regressedCount: 0,
    digestedEventCount: 4,
    storedEventCount: 4,
    firstSeen: "2026-11-24T01:00:00.000Z",
    lastSeen: "2026-11-24T02:00:00.000Z",
    lastRelease: "1.0.0",
    trackerIssueIdentifier: null,
    revision: 1,
  };
}

function makeEventItem(id = EVENT_UUID_1, eventId = "evt_abc123") {
  return {
    id,
    eventId,
    issueId: ISSUE_ID_1,
    projectId: 1,
    timestamp: "2026-11-24T02:00:00.000Z",
    ingestedAt: "2026-11-24T02:00:01.000Z",
    release: "1.0.0",
    environment: "production",
    platform: "javascript",
    level: "error",
    transaction: "GET /api/matches",
  };
}

function makeEventDetail(id = EVENT_UUID_1) {
  return {
    ...makeEventItem(id),
    stacktraceMd: "TypeError: boom\n  at handler (app.ts:10:5)",
    exceptions: [
      {
        type: "TypeError",
        value: "boom",
        mechanismType: "generic",
        handled: false,
        frames: [
          {
            filename: "app.ts",
            module: null,
            function: "handler",
            lineno: 10,
            colno: 5,
            inApp: true,
            preContext: [],
            contextLine: "throw new TypeError('boom')",
            postContext: [],
            vars: null,
          },
        ],
      },
    ],
    breadcrumbs: [],
    tags: { service: "scout" },
    contexts: {},
    request: null,
    sdk: { name: "@sentry/bun", version: "11.16.0" },
    rawData: {},
  };
}

afterEach(() => {
  restoreErrorsTestEnvironment();
});

describe("errors credential and URL configuration", () => {
  test("requires no mandatory 1Password credential for tailnet operations", () => {
    expect(requiredCredentialsFor("errors", undefined)).toEqual([]);
    expect(requiredCredentialsFor("errors", "issues")).toEqual([]);
    expect(requiredCredentialsFor("errors", "resolve")).toEqual([]);
    expect(requiredCredentialsFor("errors", "import-bugsink")).toEqual([]);
  });

  test("defaults ERRORS_URL to tailnet and normalizes /api/v1 suffix", () => {
    Reflect.deleteProperty(Bun.env, "ERRORS_URL");
    expect(errorsBaseUrl()).toBe("https://errors.tailnet-1a49.ts.net");
    expect(errorsBaseUrl("https://errors.example.test/api/v1/")).toBe(
      "https://errors.example.test",
    );
    expect(
      buildErrorsApiUrl("https://errors.example.test/api/v1", "/projects", {
        q: "test",
      }).toString(),
    ).toBe("https://errors.example.test/api/v1/projects?q=test");
  });

  test("rejects credentials and unsupported protocols in ERRORS_URL", () => {
    expect(() =>
      errorsBaseUrl("https://user:secret@errors.example.test"),
    ).toThrow(/credentials/u);
    expect(() => errorsBaseUrl("ftp://errors.example.test")).toThrow(
      /http or https/u,
    );
  });

  test("attaches optional ERRORS_TOKEN without leaking it on API failure", async () => {
    const secret = "errors-super-secret-bearer-token";
    Bun.env["ERRORS_URL"] = "https://errors.example.test";
    Bun.env["ERRORS_TOKEN"] = secret;

    const requests = installFetchMock(() =>
      Response.json({ error: "Forbidden" }, { status: 403 }),
    );

    await expect(getProjects()).rejects.toSatisfy((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("Errors API error (403): Forbidden");
      expect(message).not.toContain(secret);
      return true;
    });
    expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${secret}`);
  });
});

describe("errors read client", () => {
  test("fetches overview, projects, project detail, issue detail, event, stacktrace, and releases", async () => {
    Reflect.deleteProperty(Bun.env, "ERRORS_TOKEN");
    Bun.env["ERRORS_URL"] = "https://errors.example.test";

    const requests = installFetchMock((req) => {
      const path = new URL(req.url).pathname + new URL(req.url).search;
      if (path === "/api/v1/overview") {
        return Response.json({
          viewer: { login: "jerred@tailnet", displayName: "Jerred" },
          totalUnresolved: 2,
          totalRegressed: 1,
          activeIssues7d: 2,
          events24h: 10,
          totalDigestedEvents: 12,
          totalStoredEvents: 5,
          projects: [makeProject()],
          attentionIssues: [makeIssue()],
        });
      }
      if (path === "/api/v1/projects") {
        return Response.json({ items: [makeProject()] });
      }
      if (path === "/api/v1/projects/scout-for-lol") {
        return Response.json(makeProject());
      }
      if (path === `/api/v1/issues/${ISSUE_ID_1}`) {
        return Response.json({
          ...makeIssue(),
          fingerprints: ["fp-1"],
          latestEvent: makeEventDetail(),
        });
      }
      if (path === `/api/v1/events/${EVENT_UUID_1}`) {
        return Response.json(makeEventDetail());
      }
      if (path === `/api/v1/events/${EVENT_UUID_1}/stacktrace`) {
        return new Response("# Stacktrace\n`app.ts:10`", { status: 200 });
      }
      if (path === `/api/v1/events/${EVENT_UUID_1}/stacktrace?format=json`) {
        return Response.json({
          eventId: "evt_abc123",
          stacktraceMd: "# Stacktrace",
        });
      }
      if (path === "/api/v1/releases?project=scout-for-lol") {
        return Response.json({
          items: [
            {
              id: RELEASE_UUID_1,
              projectId: 1,
              projectSlug: "scout-for-lol",
              version: "1.0.0",
              releasedAt: "2026-11-24T00:00:00.000Z",
            },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    });

    const overview = await getOverview();
    expect(overview.totalUnresolved).toBe(2);
    const projects = await getProjects();
    expect(projects[0]?.slug).toBe("scout-for-lol");
    const project = await getProject("scout-for-lol");
    expect(project.id).toBe(1);
    const detail = await getIssue(ISSUE_ID_1);
    expect(detail.fingerprints).toEqual(["fp-1"]);
    const eventDetail = await getEvent(EVENT_UUID_1);
    expect(eventDetail.eventId).toBe("evt_abc123");
    expect(await getEventStacktrace(EVENT_UUID_1)).toContain("app.ts:10");
    expect(await getEventStacktraceJson(EVENT_UUID_1)).toEqual({
      eventId: "evt_abc123",
      stacktraceMd: "# Stacktrace",
    });
    const releases = await getReleases("scout-for-lol");
    expect(releases[0]?.version).toBe("1.0.0");
    expect(requests.every((r) => r.headers.get("authorization") === null)).toBe(
      true,
    );
  });

  test("paginates issues only when --all or --limit is set, and stops at limit", async () => {
    Bun.env["ERRORS_URL"] = "https://errors.example.test";

    const singlePageRequests = installFetchMock(() =>
      Response.json({
        items: [makeIssue(ISSUE_ID_1)],
        nextCursor: "cursor-page-2",
      }),
    );
    const firstPageOnly = await getIssues({
      project: "scout-for-lol",
      tab: "unresolved",
    });
    expect(firstPageOnly).toHaveLength(1);
    expect(singlePageRequests).toHaveLength(1);

    const allRequests = installFetchMock((req) => {
      const cursor = new URL(req.url).searchParams.get("cursor");
      return cursor === "cursor-2"
        ? Response.json({ items: [makeIssue(ISSUE_ID_2)], nextCursor: null })
        : Response.json({
            items: [makeIssue(ISSUE_ID_1)],
            nextCursor: "cursor-2",
          });
    });
    const allIssues = await getIssues({ all: true });
    expect(allIssues.map((i) => i.id)).toEqual([ISSUE_ID_1, ISSUE_ID_2]);
    expect(allRequests).toHaveLength(2);

    const limitedRequests = installFetchMock(() =>
      Response.json({
        items: [makeIssue(ISSUE_ID_1), makeIssue(ISSUE_ID_2)],
        nextCursor: "cursor-2",
      }),
    );
    const limited = await getIssues({ limit: 1 });
    expect(limited.map((i) => i.id)).toEqual([ISSUE_ID_1]);
    expect(limitedRequests).toHaveLength(1);

    const zeroRequests = installFetchMock(() =>
      Response.json({ items: [], nextCursor: null }),
    );
    expect(await getIssues({ limit: 0 })).toEqual([]);
    expect(zeroRequests).toHaveLength(0);
  });

  test("detects cursor cycles and paginates issue events up to limit", async () => {
    Bun.env["ERRORS_URL"] = "https://errors.example.test";

    installFetchMock(() =>
      Response.json({ items: [makeIssue(ISSUE_ID_1)], nextCursor: "same" }),
    );
    await expect(getIssues({ all: true })).rejects.toThrow(/pagination cycle/u);

    installFetchMock((req) => {
      const cursor = new URL(req.url).searchParams.get("cursor");
      return cursor === "ev-2"
        ? Response.json({
            items: [makeEventItem(EVENT_UUID_2, "evt_2")],
            nextCursor: null,
          })
        : Response.json({
            items: [makeEventItem(EVENT_UUID_1, "evt_1")],
            nextCursor: "ev-2",
          });
    });
    const events = await getIssueEvents(ISSUE_ID_1, { limit: 2 });
    expect(events.map((e) => e.eventId)).toEqual(["evt_1", "evt_2"]);
  });
});

describe("errors write client", () => {
  test("uses PATCH for single issue and POST bulk-update for multiple issues with Origin header", async () => {
    Bun.env["ERRORS_URL"] = "https://errors.example.test";

    const requests = installFetchMock((req) => {
      if (req.method === "PATCH") {
        return Response.json(makeIssue(ISSUE_ID_1, "RESOLVED_NEXT_RELEASE"));
      }
      return Response.json({
        updatedCount: 2,
        items: [makeIssue(ISSUE_ID_1, "MUTED"), makeIssue(ISSUE_ID_2, "MUTED")],
      });
    });

    const single = await updateIssuesState({
      ids: [ISSUE_ID_1],
      state: "RESOLVED_NEXT_RELEASE",
      resolvedInRelease: "2.0.0",
    });
    expect(single.updatedCount).toBe(1);
    expect(requests[0]?.method).toBe("PATCH");
    expect(requests[0]?.url).toBe(
      `https://errors.example.test/api/v1/issues/${ISSUE_ID_1}`,
    );
    expect(requests[0]?.headers.get("origin")).toBe(
      "https://errors.example.test",
    );
    expect(JSON.parse(requests[0]?.bodyText ?? "{}")).toEqual({
      state: "RESOLVED_NEXT_RELEASE",
      resolvedInRelease: "2.0.0",
    });

    const bulk = await updateIssuesState({
      ids: [ISSUE_ID_1, ISSUE_ID_2],
      state: "MUTED",
    });
    expect(bulk.updatedCount).toBe(2);
    expect(requests[1]?.method).toBe("POST");
    expect(requests[1]?.url).toBe(
      "https://errors.example.test/api/v1/issues/bulk-update",
    );
    expect(JSON.parse(requests[1]?.bodyText ?? "{}")).toEqual({
      ids: [ISSUE_ID_1, ISSUE_ID_2],
      state: "MUTED",
    });
  });

  test("posts tracker-issue and import-bugsink payloads", async () => {
    Bun.env["ERRORS_URL"] = "https://errors.example.test";

    const requests = installFetchMock((req) => {
      if (req.url.endsWith("/tracker-issue")) {
        return Response.json({
          trackerIssueIdentifier: "AI-101",
          trackerUrl: "https://tracker.tailnet-1a49.ts.net/issues/AI-101",
          created: true,
          issue: { ...makeIssue(ISSUE_ID_1), trackerIssueIdentifier: "AI-101" },
        });
      }
      return Response.json({
        dryRun: true,
        projectsImported: 3,
        releasesImported: 10,
        issuesImported: 25,
        eventsImported: 100,
        eventsSkippedExisting: 5,
        fingerprintsRegistered: 28,
        durationMs: 412,
      });
    });

    const tracker = await createTrackerIssue(ISSUE_ID_1, {
      title: "Fix TypeError in matches",
      urgency: "high",
      impact: "medium",
      effort: "s",
    });
    expect(tracker.trackerIssueIdentifier).toBe("AI-101");
    expect(JSON.parse(requests[0]?.bodyText ?? "{}")).toEqual({
      title: "Fix TypeError in matches",
      urgency: "high",
      impact: "medium",
      effort: "s",
    });

    const imported = await importBugsink({
      baseUrl: "https://bugsink.sjer.red",
      projectId: 7,
      concurrency: 4,
      dryRun: true,
    });
    expect(imported.issuesImported).toBe(25);
    expect(JSON.parse(requests[1]?.bodyText ?? "{}")).toEqual({
      baseUrl: "https://bugsink.sjer.red",
      projectId: 7,
      concurrency: 4,
      dryRun: true,
    });
  });
});
