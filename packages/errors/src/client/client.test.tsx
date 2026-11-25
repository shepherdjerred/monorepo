import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createThemeStore,
  type ThemeEnvironment,
} from "@shepherdjerred/console-ui";
import {
  buildProjectDsn,
  type EventDetail,
  type EventListItem,
  type IssueDetail,
  type IssueListItem,
  type OverviewResponse,
  type ProjectSummary,
  type ReleaseItem,
} from "#shared/contract.ts";
import {
  ErrorsApiError,
  bulkUpdateIssues,
  createTrackerIssue,
  fetchIssues,
  fetchOverview,
  updateIssueState,
} from "./api.ts";
import {
  formatAge,
  groupStackFrames,
  issueSeverity,
  trackerIssueUrl,
} from "./format.ts";
import { IssueDetailView } from "./issue-detail-view.tsx";
import { IssuesInboxView } from "./issues-table.tsx";
import { OverviewView } from "./overview-page.tsx";
import { ProjectsView } from "./projects-page.tsx";
import { ReleasesView } from "./releases-page.tsx";
import { ErrorsSidebar, Topbar } from "./shell-nav.tsx";

const noop = (): void => {
  // Static render tests do not invoke interactive callbacks.
};

const NOW_MS = Date.parse("2026-11-25T02:30:00Z");

function createTestTheme() {
  const env: ThemeEnvironment = {
    storage: () => ({ getItem: () => null, setItem: noop, removeItem: noop }),
    darkQuery: { matches: false, addEventListener: noop },
    root: { dataset: {} },
    onStorage: noop,
  };
  return createThemeStore("ops-theme", env);
}

const PROJECTS: readonly ProjectSummary[] = [
  {
    id: 1,
    slug: "scout-web",
    name: "Scout Web",
    publicKey: "abc123def456",
    dsn: buildProjectDsn("abc123def456", 1),
    legacyDsn: "https://abc123def456@bugsink.sjer.red/1",
    digestedEventCount: 1420,
    storedEventCount: 50,
    unresolvedCount: 4,
    regressedCount: 1,
    mutedCount: 2,
    activeIssues7d: 3,
    alertOnNewIssue: true,
    alertOnRegression: true,
    retentionMaxEvents: 50,
    createdAt: "2026-10-01T00:00:00Z",
  },
  {
    id: 2,
    slug: "golink",
    name: "Go links",
    publicKey: "999888777666",
    dsn: buildProjectDsn("999888777666", 2),
    legacyDsn: "https://999888777666@bugsink.sjer.red/2",
    digestedEventCount: 12,
    storedEventCount: 12,
    unresolvedCount: 0,
    regressedCount: 0,
    mutedCount: 0,
    activeIssues7d: 0,
    alertOnNewIssue: true,
    alertOnRegression: false,
    retentionMaxEvents: 25,
    createdAt: "2026-10-05T00:00:00Z",
  },
];

const ATTENTION_ISSUE: IssueListItem = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId: 1,
  projectSlug: "scout-web",
  projectName: "Scout Web",
  primaryFingerprint: "fp-match-loader-null",
  type: "TypeError",
  value: "Cannot read properties of null (reading 'puuid')",
  transaction: "GET /api/matches/:id",
  level: "error",
  state: "OPEN",
  resolvedInRelease: null,
  regressedCount: 2,
  digestedEventCount: 18,
  storedEventCount: 2,
  firstSeen: "2026-11-24T12:00:00Z",
  lastSeen: "2026-11-25T02:25:00Z",
  lastRelease: "scout@2026.11.24",
  trackerIssueIdentifier: "AI-412",
  revision: 3,
};

const SECOND_ISSUE: IssueListItem = {
  id: "22222222-2222-4222-8222-222222222222",
  projectId: 1,
  projectSlug: "scout-web",
  projectName: "Scout Web",
  primaryFingerprint: "fp-rate-limit-warn",
  type: "RateLimitWarning",
  value: "Riot upstream 429 retry scheduled",
  transaction: "riot.fetchSummoner",
  level: "warning",
  state: "OPEN",
  resolvedInRelease: null,
  regressedCount: 0,
  digestedEventCount: 5,
  storedEventCount: 5,
  firstSeen: "2026-11-25T01:00:00Z",
  lastSeen: "2026-11-25T02:00:00Z",
  lastRelease: null,
  trackerIssueIdentifier: null,
  revision: 1,
};

const SAMPLE_EVENT: EventDetail = {
  id: "33333333-3333-4333-8333-333333333333",
  eventId: "9f8e7d6c5b4a32109f8e7d6c5b4a3210",
  issueId: ATTENTION_ISSUE.id,
  projectId: 1,
  timestamp: "2026-11-25T02:25:00Z",
  ingestedAt: "2026-11-25T02:25:01Z",
  release: "scout@2026.11.24",
  environment: "production",
  platform: "javascript",
  level: "error",
  transaction: "GET /api/matches/:id",
  stacktraceMd:
    "TypeError: Cannot read properties of null (reading 'puuid')\n  at loadMatch (src/matches/loader.ts:42:15)",
  exceptions: [
    {
      type: "TypeError",
      value: "Cannot read properties of null (reading 'puuid')",
      mechanismType: "onerror",
      handled: false,
      frames: [
        {
          filename: "node_modules/hono/dist/compose.js",
          module: "hono",
          function: "dispatch",
          lineno: 28,
          colno: 11,
          inApp: false,
          preContext: [],
          contextLine: null,
          postContext: [],
          vars: null,
        },
        {
          filename: "node_modules/hono/dist/router.js",
          module: "hono",
          function: "matchRoute",
          lineno: 94,
          colno: 5,
          inApp: false,
          preContext: [],
          contextLine: null,
          postContext: [],
          vars: null,
        },
        {
          filename: "src/matches/loader.ts",
          module: "matches/loader",
          function: "loadMatch",
          lineno: 42,
          colno: 15,
          inApp: true,
          preContext: [
            "export async function loadMatch(id: string) {",
            "  const participant = await findParticipant(id);",
          ],
          contextLine: "  return participant.puuid;",
          postContext: ["}"],
          vars: { id: "NA1_5123456789" },
        },
      ],
    },
  ],
  breadcrumbs: [
    {
      timestamp: "2026-11-25T02:24:59Z",
      type: "http",
      category: "fetch",
      level: "info",
      message:
        "GET https://americas.api.riotgames.com/lol/match/v5/matches/NA1_5123456789",
      data: { status_code: 200 },
    },
  ],
  tags: {
    region: "na1",
    runtime: "bun",
  },
  contexts: {
    os: { name: "Linux", version: "6.12" },
  },
  request: {
    method: "GET",
    url: "https://scout.sjer.red/api/matches/NA1_5123456789",
  },
  sdk: {
    name: "sentry.javascript.bun",
    version: "11.16.0",
  },
  rawData: {
    event_id: "9f8e7d6c5b4a32109f8e7d6c5b4a3210",
    level: "error",
  },
};

const SAMPLE_ISSUE_DETAIL: IssueDetail = {
  ...ATTENTION_ISSUE,
  fingerprints: ["fp-match-loader-null"],
  latestEvent: SAMPLE_EVENT,
};

const SAMPLE_EVENTS_LIST: readonly EventListItem[] = [
  SAMPLE_EVENT,
  {
    id: "44444444-4444-4444-8444-444444444444",
    eventId: "1234567890abcdef1234567890abcdef",
    issueId: ATTENTION_ISSUE.id,
    projectId: 1,
    timestamp: "2026-11-24T12:00:00Z",
    ingestedAt: "2026-11-24T12:00:01Z",
    release: "scout@2026.11.23",
    environment: "production",
    platform: "javascript",
    level: "error",
    transaction: "GET /api/matches/:id",
  },
];

describe("Shell navigation & responsive topbar", () => {
  test("renders Triage and Projects groups with exact active route and counts", () => {
    const theme = createTestTheme();
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/issues?tab=regressed"]}>
        <ErrorsSidebar
          projects={PROJECTS}
          totalUnresolved={4}
          totalRegressed={1}
          store={theme}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Errors");
    expect(html).toContain(", switch app");
    expect(html).toContain('aria-keyshortcuts="Meta+K Control+K"');
    expect(html).toContain(">Triage</p>");
    expect(html).toContain(">Projects</p>");
    expect(html).toContain(
      '<span class="ui-nav-text">Unresolved</span><span class="ui-nav-count">4</span>',
    );
    expect(html).toContain(
      '<span class="ui-nav-text">Regressed</span><span class="ui-nav-count">1</span>',
    );
    expect(html).toContain(
      '<span class="ui-nav-text">Scout Web</span><span class="ui-nav-count">4</span>',
    );
    expect(html).toContain(
      '<span class="ui-nav-text">Go links</span><span class="ui-nav-count">0</span>',
    );
    expect(html.match(/aria-current="page"/gu)).toHaveLength(1);
    expect(html).toMatch(
      /href="\/issues\?tab=regressed"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/issues\?tab=regressed"/u,
    );
    expect(html).toContain('aria-label="Theme: system"');
  });

  test("Topbar does not mount duplicate Primary navigation landmark while closed", () => {
    const theme = createTestTheme();
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/"]}>
        <Topbar projects={PROJECTS} totalUnresolved={4} store={theme} />
      </MemoryRouter>,
    );
    expect(html).toContain('class="topbar"');
    expect(html).toContain('aria-label="Open navigation"');
    expect(html).not.toContain('aria-label="Primary navigation"');
  });
});

describe("OverviewView", () => {
  test("renders headline figures, Needs attention issues with AI chip, and Projects table", () => {
    const overview: OverviewResponse = {
      viewer: { login: "jerred", displayName: "Jerred" },
      totalUnresolved: 4,
      totalRegressed: 1,
      activeIssues7d: 3,
      events24h: 29,
      totalDigestedEvents: 1432,
      totalStoredEvents: 62,
      projects: [...PROJECTS],
      attentionIssues: [ATTENTION_ISSUE],
    };

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <OverviewView overview={overview} onRefresh={noop} nowMs={NOW_MS} />
      </MemoryRouter>,
    );

    expect(html).toContain('<h1 class="ui-header-title">Errors</h1>');
    expect(html).toContain("Jerred");
    expect(html).toContain('data-sev="warning"');
    expect(html).toContain('data-sev="error"');
    expect(html).toContain("Needs attention");
    expect(html).toContain("TypeError");
    expect(html).toContain("Cannot read properties of null");
    expect(html).toContain("scout@2026.11.24");
    expect(html).toContain("AI-412");
    expect(html).toContain(trackerIssueUrl("AI-412"));
    expect(html).toContain("5m ago");
    expect(html).toContain("Scout Web");
    expect(html).toContain("1,420");
    expect(html).toContain('class="ui-num ui-mono ui-zero">0<');
  });
});

describe("IssuesInboxView", () => {
  test("renders filter tabs, project DSN chip, contextual bulk controls, and Load more", () => {
    const project = PROJECTS[0];
    if (project === undefined) {
      throw new Error("Missing fixture project");
    }
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/projects/scout-web"]}>
        <IssuesInboxView
          title={project.name}
          tab="unresolved"
          query="puuid"
          sort="events"
          projectFilter="scout-web"
          lockedProjectSlug="scout-web"
          projectSummary={project}
          projects={PROJECTS}
          items={[ATTENTION_ISSUE, SECOND_ISSUE]}
          selectedIds={new Set([ATTENTION_ISSUE.id])}
          hasNextPage
          nowMs={NOW_MS}
          onTabChange={noop}
          onQueryChange={noop}
          onProjectFilterChange={noop}
          onSortChange={noop}
          onToggleAll={noop}
          onToggleOne={noop}
          onBulkState={noop}
          onClearSelection={noop}
          onLoadMore={noop}
          onRefresh={noop}
          onCopyDsn={noop}
        />
      </MemoryRouter>,
    );

    expect(html).toContain('<h1 class="ui-header-title">Scout Web</h1>');
    expect(html).toContain('role="radiogroup" aria-label="Filter issues"');
    expect(html).toContain("https://abc123def456@logging.sjer.red/1");
    expect(html).toContain("Copy DSN");
    expect(html).toContain("1 selected of 2");
    expect(html).toContain('aria-label="Bulk issue actions"');
    expect(html).toContain(">Resolve<");
    expect(html).toContain(">Next release<");
    expect(html).toContain(">Mute<");
    expect(html).toContain(">Reopen<");
    expect(html).toContain(">Clear<");
    expect(html).toContain(">Load more<");
    expect(html).toContain("AI-412");
  });
});

describe("IssueDetailView & stacktrace grouping", () => {
  test("groups consecutive vendor frames and expands in-app frames with context, vars, tags, breadcrumbs, and Tracker link", () => {
    const groups = groupStackFrames(SAMPLE_EVENT.exceptions[0]?.frames ?? []);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.kind).toBe("vendor");
    if (groups[0]?.kind === "vendor") {
      expect(groups[0].frames).toHaveLength(2);
    }
    expect(groups[1]?.kind).toBe("app");

    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={[`/issues/${SAMPLE_ISSUE_DETAIL.id}`]}>
        <IssueDetailView
          issue={SAMPLE_ISSUE_DETAIL}
          activeEvent={SAMPLE_EVENT}
          events={SAMPLE_EVENTS_LIST}
          nowMs={NOW_MS}
          onUpdateState={noop}
          onOpenCreateTrackerDialog={noop}
          onCopyMarkdown={noop}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Scout Web</a>");
    expect(html).toContain("Open AI-412 ↗");
    expect(html).toContain(
      "https://tracker.tailnet-1a49.ts.net/AI/issues/AI-412",
    );
    expect(html).toContain("Copy Markdown");
    expect(html).toContain("2 stored / 18 total");
    expect(html).toContain("fp-match-loader-null");
    expect(html).toContain("Event 9f8e7d6c");
    expect(html).toContain(
      `/issues/${SAMPLE_ISSUE_DETAIL.id}/events/44444444-4444-4444-8444-444444444444`,
    );
    expect(html).toContain(
      '<details class="er-vendor-frames"><summary class="er-vendor-summary">2 vendor frames</summary>',
    );
    expect(html).toContain("src/matches/loader.ts:42:15");
    expect(html).toContain("return participant.puuid;");
    expect(html).toContain("Local variables (1)");
    expect(html).toContain("NA1_5123456789");
    expect(html).toContain("Breadcrumbs");
    expect(html).toContain("Raw Event JSON");
  });

  test("offers Create AI Issue when issue is not yet linked to Tracker", () => {
    const unlinked: IssueDetail = {
      ...SAMPLE_ISSUE_DETAIL,
      trackerIssueIdentifier: null,
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <IssueDetailView
          issue={unlinked}
          activeEvent={SAMPLE_EVENT}
          events={SAMPLE_EVENTS_LIST}
          nowMs={NOW_MS}
          onUpdateState={noop}
          onOpenCreateTrackerDialog={noop}
          onCopyMarkdown={noop}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Create AI Issue");
    expect(html).not.toContain("Open AI-");
  });
});

describe("ProjectsView & ReleasesView", () => {
  test("renders Projects DSN table with copy button, alert policy checkboxes, and retention select", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProjectsView
          projects={PROJECTS}
          copiedProjectId={1}
          onCopyDsn={noop}
          onUpdateProject={noop}
          onOpenCreateDialog={noop}
          onRefresh={noop}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Projects &amp; DSNs");
    expect(html).toContain("New project");
    expect(html).toContain("https://abc123def456@logging.sjer.red/1");
    expect(html).toContain("https://999888777666@logging.sjer.red/2");
    expect(html).toContain('aria-label="Copy DSN for Scout Web"');
    expect(html).toContain(">Copied<");
    expect(html).toContain("New issue");
    expect(html).toContain("Regression");
    expect(html).toContain('aria-label="Retention max events for Scout Web"');
  });

  test("renders Releases table with project filter and release links", () => {
    const releases: readonly ReleaseItem[] = [
      {
        id: "55555555-5555-4555-8555-555555555555",
        projectId: 1,
        projectSlug: "scout-web",
        version: "scout@2026.11.24",
        releasedAt: "2026-11-24T20:00:00Z",
      },
    ];
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ReleasesView
          releases={releases}
          projects={PROJECTS}
          projectFilter="scout-web"
          nowMs={NOW_MS}
          onProjectFilterChange={noop}
          onRefresh={noop}
        />
      </MemoryRouter>,
    );

    expect(html).toContain('<h1 class="ui-header-title">Releases</h1>');
    expect(html).toContain("scout@2026.11.24");
    expect(html).toContain("6h ago");
  });
});

describe("Typed API client & format helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("maps severities and relative ages accurately", () => {
    expect(issueSeverity(ATTENTION_ISSUE)).toBe("error");
    expect(issueSeverity(SECOND_ISSUE)).toBe("warning");
    expect(
      issueSeverity({ state: "MUTED", regressedCount: 2, level: "fatal" }),
    ).toBe("unknown");
    expect(
      issueSeverity({ state: "RESOLVED", regressedCount: 0, level: "error" }),
    ).toBe("ok");
    expect(formatAge("2026-11-25T02:29:40Z", NOW_MS)).toBe("just now");
    expect(formatAge("2026-11-23T02:30:00Z", NOW_MS)).toBe("2d ago");
  });

  test("validates responses and builds query strings across API endpoints", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      urls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.startsWith("/api/v1/issues?")) {
        return Response.json(
          { items: [ATTENTION_ISSUE], nextCursor: "cur-2" },
          { status: 200 },
        );
      }
      if (url.endsWith("/tracker-issue")) {
        return Response.json(
          {
            trackerIssueIdentifier: "AI-500",
            trackerUrl: "https://tracker.tailnet-1a49.ts.net/AI/issues/AI-500",
            created: true,
            issue: { ...ATTENTION_ISSUE, trackerIssueIdentifier: "AI-500" },
          },
          { status: 201 },
        );
      }
      if (url === "/api/v1/issues/bulk-update") {
        return Response.json(
          { updatedCount: 1, items: [ATTENTION_ISSUE] },
          { status: 200 },
        );
      }
      if (url.startsWith("/api/v1/issues/")) {
        return Response.json(SAMPLE_ISSUE_DETAIL, {
          status: 200,
        });
      }
      return Response.json(
        { error: "Upstream unavailable" },
        {
          status: 503,
        },
      );
    });

    const list = await fetchIssues({
      project: "scout-web",
      tab: "regressed",
      q: "puuid",
      sort: "events",
    });
    expect(list.nextCursor).toBe("cur-2");
    expect(urls[0]).toBe(
      "GET /api/v1/issues?project=scout-web&tab=regressed&q=puuid&sort=events",
    );

    const updated = await updateIssueState(ATTENTION_ISSUE.id, {
      state: "RESOLVED",
      expectedRevision: 3,
    });
    expect(updated.id).toBe(ATTENTION_ISSUE.id);

    const bulk = await bulkUpdateIssues({
      ids: [ATTENTION_ISSUE.id],
      state: "MUTED",
    });
    expect(bulk.updatedCount).toBe(1);

    const tracker = await createTrackerIssue(ATTENTION_ISSUE.id, {
      urgency: "high",
      impact: "medium",
      effort: "s",
    });
    expect(tracker.trackerIssueIdentifier).toBe("AI-500");

    await expect(fetchOverview()).rejects.toThrow(ErrorsApiError);
  });

  test("styles.css contains zero hardcoded hex colors", async () => {
    const cssText = await Bun.file(
      new URL("styles.css", import.meta.url),
    ).text();
    expect(cssText).not.toMatch(/#[0-9a-fA-F]{3,8}\b/u);
  });
});
