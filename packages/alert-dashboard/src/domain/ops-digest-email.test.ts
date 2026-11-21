import { describe, expect, it } from "vitest";

import { renderDigestEmail } from "#domain/ops-digest-email";
import { DigestReportSchema } from "#shared/ops-schema";

const weeklyAttentionReport = DigestReportSchema.parse({
  kind: "weekly",
  periodKey: "2026-W40",
  periodStart: "2026-09-21T15:00:00Z",
  periodEnd: "2026-09-28T15:00:00Z",
  status: {
    severity: "warning",
    summary: "1 area needs attention (Delivery)",
    stale: true,
    snapshotGeneratedAt: "2026-09-28T14:00:00Z",
  },
  attention: [
    {
      id: "x",
      source: "github",
      section: "delivery",
      kind: "pull-request",
      severity: "warning",
      needsMe: false,
      title: "<script>alert(1)</script> & friends",
      links: [
        { kind: "github", label: "PR", url: "https://github.com/a?b=1&c=2" },
      ],
    },
  ],
  needsMe: [],
  newSinceLast: [],
  changes: [
    {
      id: "alerts:event_1",
      source: "alerts",
      externalId: "event_1",
      kind: "alert-resolve",
      service: "storage",
      title: "Resolved: Disk full (DiskFull)",
      occurredAt: "2026-09-28T13:15:00Z",
      severity: "ok",
      url: "https://alerts.tailnet-1a49.ts.net/alerts/alert_1",
    },
    {
      id: "github:pr:3066",
      source: "github",
      externalId: "pr:3066",
      kind: "merge",
      service: "scout-for-lol",
      title: "Merged #3066 fix(scout): recap timezone",
      occurredAt: "2026-09-28T12:00:00Z",
      severity: "info",
      url: "https://github.com/shepherdjerred/monorepo/pull/3066",
    },
  ],
  incidents: { opened: 2, resolved: 1, medianMinutesToResolve: 42 },
  trends: [
    {
      id: "deploys",
      label: "Deploys",
      unit: "count",
      current: 5,
      previous: 7,
      higherIsBetter: true,
    },
  ],
});

function signals(
  count: number,
  kind: string,
  overrides: Record<string, unknown> = {},
) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${kind}-${String(index)}`,
    source: "maintenance",
    section: "maintenance",
    kind,
    severity: "warning",
    needsMe: true,
    title: `${kind} ${String(index)}`,
    links: [
      {
        kind: "native",
        label: "Open",
        url: `https://example.com/${kind}/${String(index)}`,
      },
    ],
    ...overrides,
  }));
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function clearDigestReport(window: {
  kind: "daily" | "weekly";
  periodKey: string;
  periodStart: string;
  periodEnd: string;
}) {
  return DigestReportSchema.parse({
    ...window,
    status: {
      severity: "ok",
      summary: "All monitored areas are healthy",
      stale: false,
      snapshotGeneratedAt: "2026-11-20T15:29:00Z",
    },
    attention: [],
    needsMe: [],
    newSinceLast: [],
    changes: [],
    incidents: { opened: 0, resolved: 0, medianMinutesToResolve: null },
    trends: [],
  });
}

describe("digest email", () => {
  it("escapes upstream text and links in HTML", () => {
    const email = renderDigestEmail(weeklyAttentionReport);
    expect(email.htmlBody).toContain("<!DOCTYPE html>");
    expect(email.htmlBody).not.toContain("<script>");
    expect(email.htmlBody).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; friends",
    );
    expect(email.htmlBody).toContain('href="https://github.com/a?b=1&amp;c=2"');
  });

  it("renders plain-English subjects, humanized activity kinds, staleness, trends, and details", () => {
    const email = renderDigestEmail(weeklyAttentionReport);
    expect(email.subject).toBe("Weekly review: Attention needed (Sep 21–28)");
    expect(email.subject).not.toContain("2026-W40");
    expect(email.htmlBody).toContain("Weekly review · Sep 21–28");
    expect(email.htmlBody).not.toContain("2026-W40");
    expect(email.htmlBody).not.toContain("New this week");

    for (const body of [email.htmlBody, email.plainBody]) {
      expect(body).toContain("stale");
      expect(body).toContain("This week vs. last week");
      expect(body).toContain("Deploys");
      expect(body).toContain("−2");
      expect(body).toContain("Recent activity");
      expect(body).toContain("Resolved");
      expect(body).toContain("PR merged");
      expect(body).not.toContain("alert-resolve");
      expect(body).toContain("2 opened · 1 resolved · median 42 min");
    }
  });

  it("formats clear and action-needed daily and weekly subjects without ISO week slugs", () => {
    const dailyClear = renderDigestEmail(
      clearDigestReport({
        kind: "daily",
        periodKey: "2026-11-20",
        periodStart: "2026-11-19T15:30:00Z",
        periodEnd: "2026-11-20T15:30:00Z",
      }),
    );
    expect(dailyClear.subject).toBe("Daily digest: All clear (Nov 20)");
    expect(dailyClear.plainBody).toContain("Morning check-in · Nov 20");
    expect(dailyClear.plainBody).not.toContain("New since last digest");

    const weeklyClear = renderDigestEmail(
      clearDigestReport({
        kind: "weekly",
        periodKey: "2026-W47",
        periodStart: "2026-11-13T15:30:00Z",
        periodEnd: "2026-11-20T15:30:00Z",
      }),
    );
    expect(weeklyClear.subject).toBe("Weekly review: All clear (Nov 13–20)");
    expect(weeklyClear.plainBody).toContain("Weekly review · Nov 13–20");
    expect(weeklyClear.plainBody).not.toContain("2026-W47");

    const dailyNeedsReview = renderDigestEmail(
      DigestReportSchema.parse({
        kind: "daily",
        periodKey: "2026-11-20",
        periodStart: "2026-11-19T15:30:00Z",
        periodEnd: "2026-11-20T15:30:00Z",
        status: {
          severity: "info",
          summary: "2 items waiting on you",
          stale: false,
          snapshotGeneratedAt: "2026-11-20T15:29:00Z",
        },
        attention: [],
        needsMe: [
          {
            id: "pr:1",
            source: "github",
            section: "delivery",
            kind: "pull-request",
            severity: "info",
            needsMe: true,
            title: "Review #1",
            links: [],
          },
          {
            id: "pr:2",
            source: "github",
            section: "delivery",
            kind: "pull-request",
            severity: "info",
            needsMe: true,
            title: "Review #2",
            links: [],
          },
        ],
        newSinceLast: [
          {
            id: "pr:2",
            source: "github",
            section: "delivery",
            kind: "pull-request",
            severity: "info",
            needsMe: true,
            title: "Review #2",
            links: [],
          },
        ],
        changes: [],
        incidents: { opened: 0, resolved: 0, medianMinutesToResolve: null },
        trends: [],
      }),
    );
    expect(dailyNeedsReview.subject).toBe(
      "Daily digest: 2 items need your review",
    );
    expect(dailyNeedsReview.plainBody).toContain("New since last digest");
  });

  it("collapses same-kind signals into one row so they stop eating the cap", () => {
    const needsMe = [
      ...signals(13, "alert", { section: "alerts", source: "alerts" }),
      ...signals(10, "restore-failure"),
      ...signals(100, "renovate-approval", {
        section: "delivery",
        source: "renovate",
        severity: "info",
      }),
    ];
    const email = renderDigestEmail(
      DigestReportSchema.parse({ ...weeklyAttentionReport, needsMe }),
    );
    expect(email.subject).toBe("Weekly review: 123 items need your review");
    for (const body of [email.htmlBody, email.plainBody]) {
      expect(occurrences(body, "10 failed Velero restores")).toBe(1);
      expect(occurrences(body, "100 Renovate updates awaiting approval")).toBe(
        1,
      );
      expect(occurrences(body, "https://example.com/alert/")).toBe(13);
      expect(body).toContain("alert 12");
      expect(body).not.toContain("restore-failure 0");
      expect(body).not.toContain("more in Hub.");
    }
    expect(email.plainBody).toContain(
      "- [Warning] Maintenance — 10 failed Velero restores",
    );
    expect(email.plainBody).toContain(
      "- [Info] Delivery — 100 Renovate updates awaiting approval",
    );
  });

  it("keeps a pair of same-kind signals as individual linked rows", () => {
    const email = renderDigestEmail(
      DigestReportSchema.parse({
        ...weeklyAttentionReport,
        needsMe: signals(2, "restore-failure"),
      }),
    );
    expect(email.htmlBody).toContain("https://example.com/restore-failure/1");
    expect(email.htmlBody).toContain("restore-failure 1");
    expect(email.htmlBody).not.toContain("failed Velero restores");
  });

  it("caps rows and counts the signals left out, not the rows", () => {
    const email = renderDigestEmail(
      DigestReportSchema.parse({
        ...weeklyAttentionReport,
        needsMe: [
          ...signals(3, "restore-failure"),
          ...signals(20, "alert", { section: "alerts", source: "alerts" }),
        ],
      }),
    );
    for (const body of [email.htmlBody, email.plainBody]) {
      expect(body).toContain("3 failed Velero restores");
      expect(occurrences(body, "https://example.com/alert/")).toBe(14);
      expect(body).toContain("and 6 more in Hub.");
    }
  });
});
