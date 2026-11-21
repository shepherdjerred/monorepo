import { describe, expect, it } from "vitest";

import { renderDigestEmail } from "#domain/ops-digest-email";
import { DigestReportSchema } from "#shared/ops-schema";

const report = DigestReportSchema.parse({
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
  changes: [],
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

describe("digest email", () => {
  it("escapes upstream text and links in HTML", () => {
    const email = renderDigestEmail(report);
    expect(email.htmlBody).not.toContain("<script>");
    expect(email.htmlBody).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; friends",
    );
    expect(email.htmlBody).toContain('href="https://github.com/a?b=1&amp;c=2"');
  });

  it("states staleness, trends, and incidents in both bodies", () => {
    const email = renderDigestEmail(report);
    expect(email.subject).toBe("[Hub] Weekly digest 2026-W40: Warning");
    for (const body of [email.htmlBody, email.textBody]) {
      expect(body).toContain("stale");
      expect(body).toContain("Deploys");
      expect(body).toContain("−2");
    }
    expect(email.textBody).toContain("Incidents: 2 opened, 1 resolved");
    expect(email.htmlBody).toContain("42 min");
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
      DigestReportSchema.parse({ ...report, needsMe }),
    );
    // Counts stay per signal: the subject still says how many wait.
    expect(email.subject).toBe(
      "[Hub] Weekly digest 2026-W40: 123 waiting on you",
    );
    for (const body of [email.htmlBody, email.textBody]) {
      expect(occurrences(body, "10 failed Velero restores")).toBe(1);
      expect(occurrences(body, "100 Renovate updates awaiting approval")).toBe(
        1,
      );
      // Every alert keeps its own row and link; nothing is cut off.
      expect(occurrences(body, "https://example.com/alert/")).toBe(13);
      expect(body).toContain("alert 12");
      expect(body).not.toContain("restore-failure 0");
      expect(body).not.toContain("more on the dashboard");
    }
    expect(email.htmlBody).toMatch(
      />Warning<\/span><\/td><td[^>]*>10 failed Velero restores<\/td>/u,
    );
    expect(email.textBody).toContain("  - [Warning] 10 failed Velero restores");
    expect(email.textBody).toContain(
      "  - [Info] 100 Renovate updates awaiting approval",
    );
  });

  it("keeps a pair of same-kind signals as individual linked rows", () => {
    const email = renderDigestEmail(
      DigestReportSchema.parse({
        ...report,
        needsMe: signals(2, "restore-failure"),
      }),
    );
    expect(email.htmlBody).toContain(
      '<a href="https://example.com/restore-failure/1" style="color:#0b0b0b">restore-failure 1</a>',
    );
    expect(email.htmlBody).not.toContain("failed Velero restores");
  });

  it("caps rows and counts the signals left out, not the rows", () => {
    const email = renderDigestEmail(
      DigestReportSchema.parse({
        ...report,
        needsMe: [
          ...signals(3, "restore-failure"),
          ...signals(20, "alert", { section: "alerts", source: "alerts" }),
        ],
      }),
    );
    // 15 rows: one group covering 3 signals, then 14 alerts; 6 alerts remain.
    for (const body of [email.htmlBody, email.textBody]) {
      expect(body).toContain("3 failed Velero restores");
      expect(occurrences(body, "https://example.com/alert/")).toBe(14);
      expect(body).toContain("and 6 more on the dashboard");
    }
  });
});
