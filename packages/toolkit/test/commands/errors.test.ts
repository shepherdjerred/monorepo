import { afterEach, describe, expect, test, vi } from "vitest";
import {
  dispatchErrorsSubcommand,
  handleErrorsCommand,
} from "#handlers/errors/index.ts";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_URL = Bun.env["ERRORS_URL"];
const ORIGINAL_TOKEN = Bun.env["ERRORS_TOKEN"];

const ISSUE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ISSUE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVENT_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RELEASE_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeIssueFixture(id = ISSUE_A, state = "OPEN") {
  return {
    id,
    projectId: 2,
    projectSlug: "delivery",
    projectName: "Delivery",
    primaryFingerprint: "fp-delivery",
    type: "Error",
    value: "Release gate refused",
    transaction: "POST /api/deploy",
    level: "error",
    state,
    resolvedInRelease: null,
    regressedCount: 1,
    digestedEventCount: 3,
    storedEventCount: 3,
    firstSeen: "2026-11-24T00:00:00.000Z",
    lastSeen: "2026-11-24T01:00:00.000Z",
    lastRelease: "2.0.0",
    trackerIssueIdentifier: "AI-77",
    revision: 2,
  };
}

function makeProjectFixture() {
  return {
    id: 2,
    slug: "delivery",
    name: "Delivery",
    publicKey: "pub_delivery",
    dsn: "https://pub_delivery@logging.sjer.red/2",
    legacyDsn: "https://pub_delivery@bugsink.sjer.red/2",
    digestedEventCount: 9,
    storedEventCount: 3,
    unresolvedCount: 1,
    regressedCount: 1,
    mutedCount: 0,
    activeIssues7d: 1,
    alertOnNewIssue: true,
    alertOnRegression: true,
    retentionMaxEvents: 50,
    createdAt: "2026-11-24T00:00:00.000Z",
  };
}

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  });
  return { out, err };
}

function installFetch(
  impl: (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => Promise<Response>,
): void {
  const mockFetch: typeof fetch = Object.assign(impl, {
    preconnect: ORIGINAL_FETCH.preconnect,
  });
  globalThis.fetch = mockFetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_URL === undefined) {
    Reflect.deleteProperty(Bun.env, "ERRORS_URL");
  } else {
    Bun.env["ERRORS_URL"] = ORIGINAL_URL;
  }
  if (ORIGINAL_TOKEN === undefined) {
    Reflect.deleteProperty(Bun.env, "ERRORS_TOKEN");
  } else {
    Bun.env["ERRORS_TOKEN"] = ORIGINAL_TOKEN;
  }
});

describe("toolkit errors CLI read subcommands", () => {
  test("prints help without making network requests", async () => {
    let fetchCalls = 0;
    installFetch(async () => {
      fetchCalls += 1;
      return new Response("unexpected", { status: 500 });
    });
    const { out } = captureConsole();

    await dispatchErrorsSubcommand("--help", []);
    await dispatchErrorsSubcommand("issues", ["--help"]);

    expect(fetchCalls).toBe(0);
    expect(out[0]).toContain("toolkit errors - First-party error tracking");
    expect(out[1]).toContain("import-bugsink");
  });

  test("dispatches read subcommands in Markdown and JSON modes", async () => {
    Bun.env["ERRORS_URL"] = "https://errors.example.test";
    const urls: string[] = [];
    installFetch(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      urls.push(url);
      const parsed = new URL(url);
      if (parsed.pathname === "/api/v1/overview") {
        return Response.json({
          viewer: { login: "jerred", displayName: "Jerred" },
          totalUnresolved: 1,
          totalRegressed: 1,
          activeIssues7d: 1,
          events24h: 3,
          totalDigestedEvents: 9,
          totalStoredEvents: 3,
          projects: [makeProjectFixture()],
          attentionIssues: [makeIssueFixture()],
        });
      }
      if (parsed.pathname === "/api/v1/projects") {
        return Response.json([makeProjectFixture()]);
      }
      if (parsed.pathname === "/api/v1/projects/delivery") {
        return Response.json(makeProjectFixture());
      }
      if (parsed.pathname === "/api/v1/issues") {
        return Response.json({ items: [makeIssueFixture()], nextCursor: null });
      }
      if (parsed.pathname === `/api/v1/issues/${ISSUE_A}`) {
        return Response.json({
          ...makeIssueFixture(),
          fingerprints: ["fp-delivery"],
          latestEvent: null,
        });
      }
      if (parsed.pathname === `/api/v1/issues/${ISSUE_A}/events`) {
        return Response.json({
          items: [
            {
              id: EVENT_A,
              eventId: "evt_001",
              issueId: ISSUE_A,
              projectId: 2,
              timestamp: "2026-11-24T01:00:00.000Z",
              ingestedAt: "2026-11-24T01:00:01.000Z",
              release: "2.0.0",
              environment: "production",
              platform: "bun",
              level: "error",
              transaction: "POST /api/deploy",
            },
          ],
          nextCursor: null,
        });
      }
      if (parsed.pathname === `/api/v1/events/${EVENT_A}`) {
        return Response.json({
          id: EVENT_A,
          eventId: "evt_001",
          issueId: ISSUE_A,
          projectId: 2,
          timestamp: "2026-11-24T01:00:00.000Z",
          ingestedAt: "2026-11-24T01:00:01.000Z",
          release: "2.0.0",
          environment: "production",
          platform: "bun",
          level: "error",
          transaction: "POST /api/deploy",
          stacktraceMd: "Error: Release gate refused",
          exceptions: [],
          breadcrumbs: [],
          tags: {},
          contexts: {},
          request: null,
          sdk: null,
          rawData: {},
        });
      }
      if (parsed.pathname === `/api/v1/events/${EVENT_A}/stacktrace`) {
        return parsed.searchParams.get("format") === "json"
          ? Response.json({ stacktraceMd: "Error: Release gate refused" })
          : new Response("## Raw Stacktrace\n`deploy.ts:42`");
      }
      if (parsed.pathname === "/api/v1/releases") {
        return Response.json({
          items: [
            {
              id: RELEASE_A,
              projectId: 2,
              projectSlug: "delivery",
              version: "2.0.0",
              releasedAt: "2026-11-24T00:00:00.000Z",
            },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    });

    const { out } = captureConsole();

    await dispatchErrorsSubcommand("overview", []);
    expect(out.at(-1)).toContain("## Errors Overview");

    await dispatchErrorsSubcommand("projects", []);
    expect(out.at(-1)).toContain("Delivery");

    await dispatchErrorsSubcommand("project", ["delivery"]);
    expect(out.at(-1)).toContain("https://pub_delivery@logging.sjer.red/2");

    await dispatchErrorsSubcommand("issues", [
      "--project",
      "delivery",
      "--tab",
      "regressed",
      "--state",
      "OPEN",
      "--q",
      "gate",
      "--limit",
      "5",
    ]);
    expect(
      urls.some(
        (u) =>
          u.includes("tab=regressed") &&
          u.includes("q=gate") &&
          u.includes("limit=5"),
      ),
    ).toBe(true);

    await dispatchErrorsSubcommand("issue", [ISSUE_A]);
    expect(out.at(-1)).toContain(ISSUE_A);

    await dispatchErrorsSubcommand("events", [ISSUE_A, "--limit", "2"]);
    expect(out.at(-1)).toContain("evt_001");

    await dispatchErrorsSubcommand("event", [EVENT_A]);
    expect(out.at(-1)).toContain("## Event: evt_001");

    await dispatchErrorsSubcommand("stacktrace", [EVENT_A]);
    expect(out.at(-1)).toBe("## Raw Stacktrace\n`deploy.ts:42`");

    await dispatchErrorsSubcommand("stacktrace", [EVENT_A, "--json"]);
    expect(JSON.parse(out.at(-1) ?? "{}")).toEqual({
      stacktraceMd: "Error: Release gate refused",
    });

    await dispatchErrorsSubcommand("releases", [
      "--project",
      "delivery",
      "--json",
    ]);
    expect(JSON.parse(out.at(-1) ?? "[]")).toHaveLength(1);
  });
});

describe("toolkit errors CLI write and validation behavior", () => {
  test("dispatches write subcommands (resolve, reopen, mute, unmute, tracker-issue, import-bugsink)", async () => {
    Bun.env["ERRORS_URL"] = "https://errors.example.test";
    const calls: { method: string; url: string; body: unknown }[] = [];

    installFetch(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method ?? "GET";
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ method, url, body });

      if (url.endsWith("/tracker-issue")) {
        return Response.json({
          trackerIssueIdentifier: "AI-88",
          trackerUrl: "https://tracker.tailnet-1a49.ts.net/issues/AI-88",
          created: true,
          issue: makeIssueFixture(ISSUE_A),
        });
      }
      if (url.endsWith("/admin/import-bugsink")) {
        return Response.json({
          dryRun: true,
          projectsImported: 1,
          releasesImported: 2,
          issuesImported: 3,
          eventsImported: 4,
          eventsSkippedExisting: 0,
          fingerprintsRegistered: 3,
          durationMs: 99,
        });
      }
      if (method === "PATCH") {
        return Response.json(
          makeIssueFixture(ISSUE_A, "RESOLVED_NEXT_RELEASE"),
        );
      }
      return Response.json({
        updatedCount: 2,
        items: [
          makeIssueFixture(ISSUE_A, "OPEN"),
          makeIssueFixture(ISSUE_B, "OPEN"),
        ],
      });
    });

    const { out } = captureConsole();

    await dispatchErrorsSubcommand("resolve", [
      ISSUE_A,
      "--next-release",
      "--release",
      "2.1.0",
    ]);
    expect(calls[0]).toEqual({
      method: "PATCH",
      url: `https://errors.example.test/api/v1/issues/${ISSUE_A}`,
      body: { state: "RESOLVED_NEXT_RELEASE", resolvedInRelease: "2.1.0" },
    });

    await dispatchErrorsSubcommand("reopen", [ISSUE_A, ISSUE_B]);
    expect(calls[1]?.body).toEqual({ ids: [ISSUE_A, ISSUE_B], state: "OPEN" });

    await dispatchErrorsSubcommand("mute", [ISSUE_A, ISSUE_B]);
    expect(calls[2]?.body).toEqual({ ids: [ISSUE_A, ISSUE_B], state: "MUTED" });

    await dispatchErrorsSubcommand("unmute", [ISSUE_A, ISSUE_B]);
    expect(calls[3]?.body).toEqual({ ids: [ISSUE_A, ISSUE_B], state: "OPEN" });

    await dispatchErrorsSubcommand("tracker-issue", [
      ISSUE_A,
      "--title",
      "Investigate gate refusal",
      "--urgency",
      "HIGH",
      "--impact",
      "medium",
      "--effort",
      "xs",
    ]);
    expect(calls[4]?.body).toEqual({
      title: "Investigate gate refusal",
      urgency: "high",
      impact: "medium",
      effort: "xs",
    });
    expect(out.at(-1)).toContain("AI-88");

    await dispatchErrorsSubcommand("import-bugsink", [
      "--base-url",
      "https://bugsink.sjer.red",
      "--project",
      "2",
      "--concurrency",
      "8",
      "--dry-run",
    ]);
    expect(calls[5]?.body).toEqual({
      baseUrl: "https://bugsink.sjer.red",
      projectId: 2,
      concurrency: 8,
      dryRun: true,
    });
    expect(out.at(-1)).toContain("Bugsink Import (Dry-run)");
  });

  test("exits 1 with actionable stderr on invalid flags or unknown subcommand without leaking token", async () => {
    const token = "never-print-this-errors-token";
    Bun.env["ERRORS_TOKEN"] = token;
    const { err } = captureConsole();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("EXIT_CALLED");
    });

    await expect(handleErrorsCommand("unknown-verb", [])).rejects.toThrow(
      "EXIT_CALLED",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err.join("\n")).toContain("Unknown errors subcommand: unknown-verb");
    expect(err.join("\n")).not.toContain(token);

    await expect(
      dispatchErrorsSubcommand("issues", ["--tab", "bogus"]),
    ).rejects.toThrow("Invalid --tab: bogus");
    await expect(
      dispatchErrorsSubcommand("import-bugsink", ["--concurrency", "64"]),
    ).rejects.toThrow("between 1 and 32");
    await expect(dispatchErrorsSubcommand("resolve", [])).rejects.toThrow(
      "At least one issue UUID is required",
    );
  });
});
