import path from "node:path";
import {
  createThemeStore,
  type ThemeEnvironment,
} from "@shepherdjerred/console-ui";
import type {
  AdminMessageDetail,
  AdminMessagesResponse,
  AdminOverviewResponse,
} from "@shepherdjerred/mail/shared/contract.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test } from "vitest";

import {
  applyRetryMutationResult,
  buildAdminMessagesUrl,
  fetchAdminMessageDetail,
  fetchAdminMessages,
  fetchAdminOverview,
  MailApiError,
  mailKeys,
  postRetryMessage,
  type FetchLike,
} from "./api.ts";
import { App } from "./app.tsx";
import {
  attemptOutcomeLabel,
  attemptOutcomeSeverity,
  buildOutboxFigures,
  defaultDetailTab,
  detailDocumentTitle,
  formatBytes,
  formatDiagnosticSummary,
  formatDurationMs,
  formatPacificFull,
  formatPacificTimestamp,
  formatRecipientsCompact,
  formatRelayMeta,
  formatSenderCount,
  messageStatusLabel,
  messageStatusSeverity,
  outboxDocumentTitle,
  parseOutboxFilter,
  type OutboxFilter,
} from "./format.ts";
import { MessageDetailView } from "./message-detail-page.tsx";
import {
  clearPendingSearchFocus,
  focusSearchOrQueue,
  hasPendingSearchFocus,
  isSlashSearchShortcut,
  setNavDrawerOpen,
} from "./nav-state.ts";
import {
  isOutboxItemCurrent,
  isSenderItemCurrent,
  SENDER_ITEMS,
} from "./shell.tsx";

const noop = (): void => undefined;

function createTestTheme() {
  const environment: ThemeEnvironment = {
    storage: () => ({ getItem: () => null, setItem: noop, removeItem: noop }),
    darkQuery: { matches: false, addEventListener: noop },
    root: { dataset: {} },
    onStorage: noop,
  };
  return createThemeStore("ops-theme", environment);
}

const OVERVIEW_FIXTURE: AdminOverviewResponse = {
  counts: {
    all: 42,
    queued: 1,
    sending: 0,
    retrying: 2,
    active: 3,
    sent: 37,
    failed: 2,
    sent24h: 19,
    failed24h: 2,
  },
  relay: {
    enabled: true,
    upstreamHost: "smtp.fastmail.com",
    upstreamPort: 587,
    smtpListenerPort: 25,
    smtpTlsCertExpiresAt: "2026-12-15T18:00:00.000Z",
    retentionDays: 30,
  },
  clients: [
    {
      clientId: "alert-dashboard",
      sent24h: 12,
      failed24h: 1,
      activeCount: 2,
      totalCount: 15,
    },
    {
      clientId: "media",
      sent24h: 5,
      failed24h: 0,
      activeCount: 0,
      totalCount: 8,
    },
    {
      clientId: "seerr",
      sent24h: 0,
      failed24h: 0,
      activeCount: 0,
      totalCount: 0,
    },
  ],
};

const MESSAGES_FIXTURE: AdminMessagesResponse = {
  total: 3,
  items: [
    {
      id: "msg_sent_1",
      clientId: "alert-dashboard",
      protocol: "http",
      rfcMessageId: "<msg_sent_1@mail.sjer.red>",
      mailFrom: "ops@sjer.red",
      recipients: ["jerred@sjer.red", "backup@sjer.red"],
      fromHeader: "Hub Ops <ops@sjer.red>",
      toHeader: "jerred@sjer.red, backup@sjer.red",
      subject: "Daily homelab digest",
      tag: "daily-digest",
      sizeBytes: 4096,
      status: "sent",
      attemptCount: 1,
      nextAttemptAt: "2026-11-24T16:00:00.000Z",
      createdAt: "2026-11-24T16:00:00.000Z",
      updatedAt: "2026-11-24T16:00:02.000Z",
      sentAt: "2026-11-24T16:00:02.000Z",
      failedAt: null,
      lastSmtpCode: 250,
      lastSmtpResponse: "2.0.0 Ok: queued as 9F2A1",
      lastError: null,
    },
    {
      id: "msg_retry_2",
      clientId: "temporal",
      protocol: "http",
      rfcMessageId: "<msg_retry_2@mail.sjer.red>",
      mailFrom: "reports@sjer.red",
      recipients: ["jerred@sjer.red"],
      fromHeader: "Reports <reports@sjer.red>",
      toHeader: "jerred@sjer.red",
      subject: "Weekly link-rot report",
      tag: null,
      sizeBytes: 2048,
      status: "retrying",
      attemptCount: 2,
      nextAttemptAt: "2026-11-24T17:10:00.000Z",
      createdAt: "2026-11-24T17:00:00.000Z",
      updatedAt: "2026-11-24T17:05:00.000Z",
      sentAt: null,
      failedAt: null,
      lastSmtpCode: 451,
      lastSmtpResponse: "4.7.1 Try again later",
      lastError: "Upstream temporary rate limit",
    },
    {
      id: "msg_failed_3",
      clientId: "storm-forum-prod",
      protocol: "smtp",
      rfcMessageId: "<msg_failed_3@storm.sjer.red>",
      mailFrom: "noreply@storm.sjer.red",
      recipients: ["player@example.com"],
      fromHeader: "The Storm Forum <noreply@storm.sjer.red>",
      toHeader: "player@example.com",
      subject: "Verify your Storm Forum account",
      tag: "signup",
      sizeBytes: 1536,
      status: "failed",
      attemptCount: 4,
      nextAttemptAt: "2026-11-24T18:00:00.000Z",
      createdAt: "2026-11-24T17:30:00.000Z",
      updatedAt: "2026-11-24T18:00:00.000Z",
      sentAt: null,
      failedAt: "2026-11-24T18:00:00.000Z",
      lastSmtpCode: 550,
      lastSmtpResponse:
        "5.1.1 <player@example.com>: Recipient address rejected",
      lastError: "Permanent rejection from Fastmail relay",
    },
  ],
};

const DETAIL_FIXTURE: AdminMessageDetail = {
  ...MESSAGES_FIXTURE.items[2]!,
  idempotencyKey: "storm-signup-9812",
  plainBody: "Welcome to The Storm Forum. Confirm your account.",
  htmlBody:
    "<html><body><h1>Welcome</h1><script>alert(1)</script></body></html>",
  headers: {
    "X-Mailer": "Discourse",
    "List-Unsubscribe": "<mailto:unsubscribe@storm.sjer.red>",
  },
  attempts: [
    {
      id: 101,
      attemptNumber: 1,
      startedAt: "2026-11-24T17:30:01.000Z",
      finishedAt: "2026-11-24T17:30:01.420Z",
      durationMs: 420,
      outcome: "transient_error",
      smtpCode: 421,
      smtpResponse: "4.3.2 Service shutting down",
      error: "Connection closed during DATA",
    },
    {
      id: 102,
      attemptNumber: 2,
      startedAt: "2026-11-24T18:00:00.000Z",
      finishedAt: "2026-11-24T18:00:01.250Z",
      durationMs: 1250,
      outcome: "permanent_error",
      smtpCode: 550,
      smtpResponse: "5.1.1 Recipient address rejected",
      error: "Permanent rejection from Fastmail relay",
    },
  ],
};

function renderApp(
  initialEntry: string,
  seedCache?: (client: QueryClient) => void,
): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  seedCache?.(queryClient);
  const theme = createTestTheme();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <App theme={theme} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  setNavDrawerOpen(false);
  clearPendingSearchFocus();
});

describe("StatusGlyph severity mapping and formatting helpers", () => {
  test("maps every outbound message status and delivery attempt outcome cleanly", () => {
    expect(messageStatusSeverity("sent")).toBe("ok");
    expect(messageStatusSeverity("queued")).toBe("info");
    expect(messageStatusSeverity("sending")).toBe("info");
    expect(messageStatusSeverity("retrying")).toBe("warning");
    expect(messageStatusSeverity("failed")).toBe("error");

    expect(messageStatusLabel("queued")).toBe("Queued");
    expect(messageStatusLabel("sending")).toBe("Sending");
    expect(messageStatusLabel("retrying")).toBe("Retrying");
    expect(messageStatusLabel("sent")).toBe("Sent");
    expect(messageStatusLabel("failed")).toBe("Failed");

    expect(attemptOutcomeSeverity("sent")).toBe("ok");
    expect(attemptOutcomeSeverity("transient_error")).toBe("warning");
    expect(attemptOutcomeSeverity("permanent_error")).toBe("error");
    expect(attemptOutcomeLabel("transient_error")).toBe("Transient error");
    expect(attemptOutcomeLabel("permanent_error")).toBe("Permanent error");
  });

  test("parses URL filters, builds document titles, and formats Pacific timestamps", () => {
    const empty = parseOutboxFilter(new URLSearchParams());
    expect(empty).toEqual({});
    expect(outboxDocumentTitle(empty)).toBe("Outbox | Mail");

    const failed = parseOutboxFilter(new URLSearchParams("status=failed"));
    expect(outboxDocumentTitle(failed)).toBe("Failed | Mail");

    const hub = parseOutboxFilter(
      new URLSearchParams("client=alert-dashboard"),
    );
    expect(outboxDocumentTitle(hub)).toBe("Hub | Mail");

    expect(detailDocumentTitle("Verify your Storm Forum account")).toBe(
      "Verify your Storm Forum account | Mail",
    );
    expect(detailDocumentTitle("")).toBe("Message | Mail");

    expect(formatPacificTimestamp("2026-11-24T16:00:00.000Z")).toBe(
      "Nov 24, 08:00 PT",
    );
    expect(formatPacificFull("2026-11-24T16:00:02.000Z")).toBe(
      "Nov 24, 2026, 08:00:02 PT",
    );
    expect(formatPacificFull(null)).toBe("—");

    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(4096)).toBe("4.0 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatDurationMs(420)).toBe("420ms");
    expect(formatDurationMs(1250)).toBe("1.25s");
    expect(
      formatRecipientsCompact(["a@sjer.red", "b@sjer.red", "c@sjer.red"]),
    ).toBe("a@sjer.red +2");
  });

  test("formats relay status, FigureStrip severities, sender counts, and default detail tab", () => {
    expect(formatRelayMeta(OVERVIEW_FIXTURE.relay)).toBe(
      "Relay active · smtp.fastmail.com:587 · TLS cert expires Dec 15, 2026",
    );
    expect(
      formatRelayMeta({
        ...OVERVIEW_FIXTURE.relay,
        enabled: false,
        smtpTlsCertExpiresAt: null,
      }),
    ).toBe("Relay paused");

    const figures = buildOutboxFigures(OVERVIEW_FIXTURE);
    expect(figures).toEqual([
      {
        label: "Queued / retrying",
        value: 3,
        severity: "warning",
        hint: "1 queued · 2 retrying",
      },
      { label: "Sent (24h)", value: 19, severity: "ok" },
      { label: "Failed (24h)", value: 2, severity: "error" },
      { label: "Stored", value: 42, hint: "30d retention" },
    ]);

    const calmFigures = buildOutboxFigures({
      ...OVERVIEW_FIXTURE,
      counts: { ...OVERVIEW_FIXTURE.counts, active: 0, failed24h: 0 },
    });
    expect(calmFigures[0]?.severity).toBe("ok");
    expect(calmFigures[2]?.severity).toBe("ok");

    expect(formatSenderCount(OVERVIEW_FIXTURE.clients[0])).toBe("2/15");
    expect(formatSenderCount(OVERVIEW_FIXTURE.clients[1])).toBe(8);
    expect(formatSenderCount(OVERVIEW_FIXTURE.clients[2])).toBeUndefined();
    expect(formatSenderCount(undefined)).toBeUndefined();

    expect(
      defaultDetailTab({ plainBody: "hello", htmlBody: "<p>hi</p>" }),
    ).toBe("plain");
    expect(defaultDetailTab({ plainBody: null, htmlBody: "<p>hi</p>" })).toBe(
      "html",
    );
    expect(defaultDetailTab({ plainBody: "", htmlBody: null })).toBe(
      "diagnostics",
    );

    expect(formatDiagnosticSummary(DETAIL_FIXTURE)).toEqual({
      label: "Last Error",
      value: "550 — Permanent rejection from Fastmail relay",
      isError: true,
    });
    expect(formatDiagnosticSummary(MESSAGES_FIXTURE.items[0]!)).toEqual({
      label: "Fastmail SMTP Response",
      value: "250 2.0.0 Ok: queued as 9F2A1",
      isError: false,
    });
  });
});

describe("Shell, routing, and Outbox view", () => {
  test("renders Hub-style shell, single primary nav when drawer closed, FigureStrip, and accessible outbox table", () => {
    const emptyFilter: OutboxFilter = {};
    const html = renderApp("/", (client) => {
      client.setQueryData(mailKeys.overview(), OVERVIEW_FIXTURE);
      client.setQueryData(mailKeys.messages(emptyFilter), MESSAGES_FIXTURE);
    });

    expect(html).toContain("<title>Outbox | Mail</title>");
    expect(html).toContain('class="skip-link" href="#content"');
    expect(html).toContain('id="content" tabindex="-1"');
    expect(html.match(/<main\b/gu)).toHaveLength(1);
    expect(html.match(/<nav\b/gu)).toHaveLength(1);
    expect(html).toContain('<nav class="ui-nav" aria-label="Primary">');
    expect(html).not.toContain('aria-label="Primary navigation"');
    expect(html).toContain('aria-label="Open menu"');
    expect(html).toContain('aria-label="Search outbox"');
    expect(html).toContain(
      "Relay active · smtp.fastmail.com:587 · TLS cert expires Dec 15, 2026",
    );

    expect(SENDER_ITEMS.map((item) => item.label)).toEqual([
      "Hub",
      "Media",
      "Temporal",
      "Alertmanager",
      "Storm Forum",
      "Bugsink",
      "Seerr",
    ]);
    expect(html).toContain(
      '<span class="ui-nav-text">Queued &amp; retrying</span><span class="ui-nav-count">3</span>',
    );
    expect(html).toContain(
      '<span class="ui-nav-text">Failed</span><span class="ui-nav-count">2</span>',
    );
    expect(html).toContain(
      '<span class="ui-nav-text">Hub</span><span class="ui-nav-count">2/15</span>',
    );
    expect(html).toContain(
      '<span class="ui-nav-text">Media</span><span class="ui-nav-count">8</span>',
    );
    expect(html).toContain('<span class="ui-nav-text">Seerr</span></a>');

    expect(html.match(/aria-current="page"/gu)).toHaveLength(1);

    expect(html).toContain(
      'class="ui-table-scroll mail-table-wrap" role="region" aria-label="Outbound messages" tabindex="0"',
    );
    expect(html).toContain(
      '<caption class="ui-sr-only">Outbound mail messages</caption>',
    );
    expect(html).toContain('<th scope="col">Status</th>');
    expect(html).toContain('<th scope="col">Subject</th>');
    expect(html).toContain('<th scope="col">Sender</th>');
    expect(html).toContain('<th scope="col">Recipient</th>');
    expect(html).toContain('<th scope="col" class="ui-num">Attempts</th>');
    expect(html).toContain('<th scope="col">Updated</th>');
    expect(html).toContain('href="/messages/msg_sent_1"');
    expect(html).toContain('data-sev="ok"');
    expect(html).toContain('data-sev="warning"');
    expect(html).toContain('data-sev="error"');
  });

  test("applies exact aria-current filter matching for status and sender routes and renders Clear filters", () => {
    const failedFilter: OutboxFilter = { status: "failed" };
    const failedHtml = renderApp("/?status=failed", (client) => {
      client.setQueryData(mailKeys.overview(), OVERVIEW_FIXTURE);
      client.setQueryData(mailKeys.messages(failedFilter), {
        items: [MESSAGES_FIXTURE.items[2]!],
        total: 1,
      });
    });

    expect(failedHtml).toContain("<title>Failed | Mail</title>");
    expect(failedHtml).toContain('<h1 class="ui-header-title">Failed</h1>');
    expect(failedHtml).toContain(">Clear filters<");
    expect(failedHtml).toContain(">1 message<");
    expect(failedHtml.match(/aria-current="page"/gu)).toHaveLength(1);
    expect(failedHtml).toMatch(
      /<a [^>]*aria-current="page"[^>]*href="\/\?status=failed"|<a [^>]*href="\/\?status=failed"[^>]*aria-current="page"/u,
    );

    const hubFilter: OutboxFilter = { client: "alert-dashboard" };
    const hubHtml = renderApp("/?client=alert-dashboard", (client) => {
      client.setQueryData(mailKeys.overview(), OVERVIEW_FIXTURE);
      client.setQueryData(mailKeys.messages(hubFilter), {
        items: [MESSAGES_FIXTURE.items[0]!],
        total: 1,
      });
    });

    expect(hubHtml).toContain("<title>Hub | Mail</title>");
    expect(hubHtml).toContain('<h1 class="ui-header-title">Hub</h1>');
    expect(hubHtml.match(/aria-current="page"/gu)).toHaveLength(1);
    expect(hubHtml).toMatch(
      /<a [^>]*aria-current="page"[^>]*href="\/\?client=alert-dashboard"|<a [^>]*href="\/\?client=alert-dashboard"[^>]*aria-current="page"/u,
    );

    const combined: OutboxFilter = {
      status: "failed",
      client: "alert-dashboard",
    };
    expect(isOutboxItemCurrent("/", combined, "failed")).toBe(false);
    expect(isSenderItemCurrent("/", combined, "alert-dashboard")).toBe(false);
    expect(isOutboxItemCurrent("/messages/msg_1", {}, undefined)).toBe(false);
  });

  test("handles keyboard slash search shortcut safely outside editable inputs", () => {
    expect(
      isSlashSearchShortcut({
        key: "/",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: null,
      }),
    ).toBe(true);
    expect(
      isSlashSearchShortcut({
        key: "/",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        target: null,
      }),
    ).toBe(false);
    expect(focusSearchOrQueue()).toBe(false);
    expect(hasPendingSearchFocus()).toBe(true);
  });
});

describe("Message Detail view, sandboxed HTML preview, and retry mutation", () => {
  test("renders metadata grid, retry button on failed/retrying, tabs, attempts & headers tables, and sandboxed iframe", () => {
    const html = renderApp("/messages/msg_failed_3", (client) => {
      client.setQueryData(mailKeys.overview(), OVERVIEW_FIXTURE);
      client.setQueryData(mailKeys.message("msg_failed_3"), DETAIL_FIXTURE);
    });

    expect(html).toContain(
      "<title>Verify your Storm Forum account | Mail</title>",
    );
    expect(html).toContain("← Outbox");
    expect(html).toContain("Storm Forum · SMTP · 1.5 KB");
    expect(html).toContain(">Retry delivery<");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('class="mail-meta-grid"');
    expect(html).toContain("storm-signup-9812");
    expect(html).toContain("550 — Permanent rejection from Fastmail relay");

    expect(html).toContain(
      '<div role="tabpanel" aria-label="Plain text"><div class="mail-tabpanel-body"><pre class="mail-plain-body">Welcome to The Storm Forum. Confirm your account.</pre>',
    );

    expect(html).toContain('class="mail-html-preview"');
    expect(html).toContain(
      'title="HTML email preview: Verify your Storm Forum account"',
    );
    expect(html).toContain('sandbox=""');
    expect(html).toMatch(/referrerpolicy="no-referrer"/iu);
    expect(html).not.toContain('scrolling="no"');

    expect(html).toContain(
      '<caption class="mail-table-caption">Delivery attempts</caption>',
    );
    expect(html).toContain(
      '<caption class="mail-table-caption">Message headers</caption>',
    );
    expect(html).toContain(">Transient error<");
    expect(html).toContain(">Permanent error<");
    expect(html).toContain(">List-Unsubscribe<");
  });

  test("defaults to HTML preview when plainBody is absent and hides Retry delivery for sent messages", () => {
    const htmlOnlySent: AdminMessageDetail = {
      ...DETAIL_FIXTURE,
      id: "msg_html_sent",
      status: "sent",
      plainBody: null,
      failedAt: null,
      sentAt: "2026-11-24T18:05:00.000Z",
      lastError: null,
    };
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/messages/msg_html_sent"]}>
        <MessageDetailView
          detail={htmlOnlySent}
          isRetrying={false}
          retryNotice="Queued message msg_html_sent for immediate delivery retry."
          retryError={null}
          onRetry={noop}
        />
      </MemoryRouter>,
    );

    expect(html).not.toContain(">Retry delivery<");
    expect(html).toContain(
      '<div role="tabpanel" aria-label="HTML preview"><div class="mail-tabpanel-body"><iframe',
    );
    expect(html).toContain(
      '<div role="tabpanel" aria-label="Plain text" hidden="">',
    );
    expect(html).toContain(
      "Queued message msg_html_sent for immediate delivery retry.",
    );
  });

  test("validates API responses with Zod, posts retry requests, and invalidates overview/list/detail queries", async () => {
    expect(buildAdminMessagesUrl({})).toBe("/api/admin/messages");
    expect(
      buildAdminMessagesUrl({ status: "failed", client: "media", q: "digest" }),
    ).toBe("/api/admin/messages?status=failed&clientId=media&q=digest");

    const calls: { url: string; method: string }[] = [];
    const fakeFetch: FetchLike = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = init?.method ?? "GET";
      calls.push({ url, method });

      if (url === "/api/admin/overview") {
        return Response.json(OVERVIEW_FIXTURE, { status: 200 });
      }
      if (url.startsWith("/api/admin/messages?")) {
        return Response.json(MESSAGES_FIXTURE, { status: 200 });
      }
      if (
        url === "/api/admin/messages/msg_failed_3/retry" &&
        method === "POST"
      ) {
        return Response.json(
          {
            message: {
              ...DETAIL_FIXTURE,
              status: "queued",
              failedAt: null,
              lastError: null,
            },
          },
          { status: 200 },
        );
      }
      return url === "/api/admin/messages/missing"
        ? Response.json({ error: "Message not found" }, { status: 404 })
        : new Response("unexpected", { status: 500 });
    };

    const overview = await fetchAdminOverview({ fetchImpl: fakeFetch });
    expect(overview.counts.active).toBe(3);

    const list = await fetchAdminMessages(
      { status: "failed" },
      { fetchImpl: fakeFetch },
    );
    expect(list.items).toHaveLength(3);

    await expect(
      fetchAdminMessageDetail("missing", { fetchImpl: fakeFetch }),
    ).rejects.toEqual(new MailApiError("Message not found", 404));

    const queryClient = new QueryClient();
    queryClient.setQueryData(mailKeys.overview(), OVERVIEW_FIXTURE);
    queryClient.setQueryData(mailKeys.messages({}), MESSAGES_FIXTURE);
    queryClient.setQueryData(mailKeys.message("msg_failed_3"), DETAIL_FIXTURE);

    const retryResult = await postRetryMessage("msg_failed_3", {
      fetchImpl: fakeFetch,
    });
    await applyRetryMutationResult(queryClient, "msg_failed_3", retryResult);

    expect(calls).toContainEqual({
      url: "/api/admin/messages/msg_failed_3/retry",
      method: "POST",
    });
    expect(
      queryClient.getQueryData<AdminMessageDetail>(
        mailKeys.message("msg_failed_3"),
      )?.status,
    ).toBe("queued");
    expect(queryClient.getQueryState(mailKeys.overview())?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(mailKeys.messages({}))?.isInvalidated,
    ).toBe(true);
  });
});

describe("Stylesheet and entrypoint compliance", () => {
  test("main.tsx imports console-ui styles before local styles.css", async () => {
    const mainSource = await Bun.file(
      path.join(import.meta.dirname, "main.tsx"),
    ).text();
    const consoleUiIndex = mainSource.indexOf(
      '"@shepherdjerred/console-ui/styles/index.css"',
    );
    const localStylesIndex = mainSource.indexOf('"./styles.css"');
    expect(consoleUiIndex).toBeGreaterThanOrEqual(0);
    expect(localStylesIndex).toBeGreaterThan(consoleUiIndex);
  });

  test("styles.css uses only --ui-* tokens with zero hex/rgb/hsl color literals and keeps tabpanels and iframes accessible", async () => {
    const rawCss = await Bun.file(
      path.join(import.meta.dirname, "styles.css"),
    ).text();
    const css = rawCss.replaceAll(/\/\*[\s\S]*?\*\//gu, "");

    expect(css.match(/#[0-9a-f]{3,8}\b/giu)).toBeNull();
    expect(css.match(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\s*\(/giu)).toBeNull();
    expect(css).not.toMatch(/\[role=["']?tabpanel["']?\]\s*\{/iu);

    const iframeBlock =
      /\.mail-html-preview\s*\{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(iframeBlock).not.toMatch(/overflow\s*:\s*hidden/iu);
  });
});
