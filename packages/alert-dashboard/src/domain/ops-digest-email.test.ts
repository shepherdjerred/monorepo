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
    expect(email.subject).toBe("[Ops] Weekly digest 2026-W40: Warning");
    for (const body of [email.htmlBody, email.textBody]) {
      expect(body).toContain("stale");
      expect(body).toContain("Deploys");
      expect(body).toContain("−2");
    }
    expect(email.textBody).toContain("Incidents: 2 opened, 1 resolved");
    expect(email.htmlBody).toContain("42 min");
  });
});
