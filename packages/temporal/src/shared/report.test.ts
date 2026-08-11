import { describe, expect, test } from "bun:test";
import {
  renderReportHtml,
  renderReportText,
  reportSubject,
  ReportEnvelopeV1Schema,
  type ReportEnvelopeV1,
} from "./report.ts";

function validReport(): ReportEnvelopeV1 {
  return {
    schemaVersion: 1,
    reportRunId: "dependency-summary:run-1",
    reportType: "dependency-summary",
    title: "Dependency summary",
    scheduleId: "deps-summary-weekly",
    startedAt: "2026-08-10T16:00:00.000Z",
    completedAt: "2026-08-10T16:01:00.000Z",
    execution: "complete",
    verdict: "clear",
    headline: "No dependency changes were found in the verified window.",
    checks: [
      {
        id: "catalog-diff",
        label: "Catalog diff",
        required: true,
        status: "passed",
        summary: "Both catalog endpoints were read successfully.",
        evidenceReceiptIds: ["git-diff"],
      },
    ],
    evidence: [
      {
        id: "git-diff",
        source: "git",
        observedAt: "2026-08-10T16:00:30.000Z",
        status: "success",
        command: "git diff old new -- version-catalog.json",
        exitCode: 0,
        contentSha256:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ],
    findings: [],
    limitations: [],
    actions: [],
    provenance: {
      workflowId: "deps-summary-weekly-2026-08-10",
      runId: "run-1",
      repoSha: "abc123",
      windowStart: "2026-08-03T16:00:00.000Z",
      windowEnd: "2026-08-10T16:00:00.000Z",
    },
  };
}

describe("ReportEnvelopeV1", () => {
  test("derives deterministic subjects", () => {
    expect(reportSubject(validReport())).toBe("[OK] Dependency summary");
    expect(
      reportSubject({
        ...validReport(),
        execution: "partial",
        verdict: "inconclusive",
      }),
    ).toBe("[PARTIAL] Dependency summary");
    expect(
      reportSubject({
        ...validReport(),
        execution: "failed",
        verdict: "attention",
      }),
    ).toBe("[FAILED] Dependency summary");
    for (const [verdict, prefix] of [
      ["changed", "CHANGED"],
      ["attention", "ATTENTION"],
      ["pending", "PENDING"],
      ["inconclusive", "INCONCLUSIVE"],
    ] as const) {
      expect(reportSubject({ ...validReport(), verdict })).toBe(
        `[${prefix}] Dependency summary`,
      );
    }
  });

  test("rejects a clean claim without complete required evidence", () => {
    const report = validReport();
    const check = report.checks[0];
    if (check === undefined) throw new TypeError("expected check fixture");
    report.checks[0] = {
      ...check,
      status: "skipped",
      evidenceReceiptIds: [],
    };
    expect(() => ReportEnvelopeV1Schema.parse(report)).toThrow(
      "clear verdict requires complete required-check coverage",
    );
  });

  test("rejects passed required checks without successful receipts", () => {
    const report = validReport();
    const receipt = report.evidence[0];
    if (receipt === undefined) throw new TypeError("expected evidence fixture");
    report.evidence[0] = { ...receipt, status: "failure" };
    expect(() => ReportEnvelopeV1Schema.parse(report)).toThrow(
      "a passed check needs successful evidence",
    );
  });

  test("separates complete execution from an adverse domain verdict", () => {
    const report = validReport();
    const check = report.checks[0];
    if (check === undefined) throw new TypeError("expected check fixture");
    report.checks[0] = {
      ...check,
      status: "failed",
      summary: "The independently evaluated gate failed.",
    };
    report.verdict = "attention";

    expect(ReportEnvelopeV1Schema.parse(report)).toMatchObject({
      execution: "complete",
      verdict: "attention",
    });
  });

  test("rejects complete execution when required evidence collection failed", () => {
    const report = validReport();
    const check = report.checks[0];
    const receipt = report.evidence[0];
    if (check === undefined || receipt === undefined) {
      throw new TypeError("expected report fixtures");
    }
    report.checks[0] = {
      ...check,
      status: "failed",
      summary: "The collector failed.",
    };
    report.evidence[0] = { ...receipt, status: "failure" };
    report.verdict = "attention";

    expect(() => ReportEnvelopeV1Schema.parse(report)).toThrow(
      "complete execution requires successful evidence coverage",
    );
  });

  test("rejects findings without evidence references", () => {
    const report = validReport();
    report.findings = [
      {
        severity: "warning",
        summary: "Unsupported finding",
        evidenceReceiptIds: [],
      },
    ];
    expect(() => ReportEnvelopeV1Schema.parse(report)).toThrow();
  });

  test("rejects unknown evidence references", () => {
    const report = validReport();
    const check = report.checks[0];
    if (check === undefined) throw new TypeError("expected check fixture");
    report.checks[0] = {
      ...check,
      evidenceReceiptIds: ["missing"],
    };
    expect(() => ReportEnvelopeV1Schema.parse(report)).toThrow(
      "unknown evidence receipt: missing",
    );
  });

  test("caps synthesis at 80 words", () => {
    const report = validReport();
    report.synthesis = Array.from({ length: 81 }, () => "word").join(" ");
    expect(() => ReportEnvelopeV1Schema.parse(report)).toThrow(
      "synthesis must contain at most 80 words",
    );
  });

  test("renders facts first and escapes HTML", () => {
    const report = validReport();
    report.headline = "No <unsafe> changes";
    const html = renderReportHtml(report);
    const text = renderReportText(report);
    expect(html).toContain("No &lt;unsafe&gt; changes");
    expect(html).not.toContain("<unsafe>");
    expect(text).toStartWith("[OK] Dependency summary\nNo <unsafe> changes");
    expect(text).toContain("[passed] Catalog diff");
    expect(text).toContain("[evidence: git-diff]");
  });

  test("renders finding sections and evidence links", () => {
    const report = validReport();
    const receipt = report.evidence[0];
    if (receipt === undefined) throw new TypeError("expected evidence fixture");
    report.evidence[0] = {
      ...receipt,
      url: "https://example.com/evidence",
    };
    report.findings = [
      {
        section: "Upstream upgrades",
        severity: "info",
        summary: "Example upgraded",
        evidenceReceiptIds: ["git-diff"],
      },
    ];
    const html = renderReportHtml(report);
    const text = renderReportText(report);
    expect(html).toContain("<h2>Upstream upgrades</h2>");
    expect(html).toContain(
      '<a href="https://example.com/evidence">git-diff</a>',
    );
    expect(text).toContain("Upstream upgrades");
    expect(text).toContain("https://example.com/evidence");
  });

  test("restricts and sanitizes evidence links", () => {
    const report = validReport();
    const receipt = report.evidence[0];
    if (receipt === undefined) throw new TypeError("expected evidence fixture");
    report.evidence[0] = {
      ...receipt,
      url: 'https://example.com/" onmouseover="alert(1)',
    };

    const html = renderReportHtml(report);
    expect(html).toContain(
      '<a href="https://example.com/%22%20onmouseover=%22alert(1)">git-diff</a>',
    );
    expect(html).not.toContain('" onmouseover="');
    expect(() =>
      ReportEnvelopeV1Schema.parse({
        ...report,
        evidence: [{ ...receipt, url: "javascript:alert(1)" }],
      }),
    ).toThrow();
  });

  test("keeps compact HTML and plain-text snapshots stable", () => {
    expect(renderReportHtml(validReport())).toMatchSnapshot();
    expect(renderReportText(validReport())).toMatchSnapshot();
  });
});
