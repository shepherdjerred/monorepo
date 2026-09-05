import { describe, expect, test } from "vitest";
import {
  hasTailoredReportPresentation,
  presentReport,
  reportSubject,
  TAILORED_REPORT_TYPES,
} from "./report-presentation.ts";
import { renderReportHtml, renderReportText } from "./report-renderer.ts";
import { ReportEnvelopeV1Schema, type ReportEnvelopeV1 } from "./report.ts";

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

type SubjectCase = {
  reportType: string;
  title: string;
  execution: ReportEnvelopeV1["execution"];
  verdict: ReportEnvelopeV1["verdict"];
  expected: string;
};

const SUBJECT_CASES = [
  {
    reportType: "agent-task",
    title: "Agent Task: Inspect production",
    execution: "complete",
    verdict: "clear",
    expected: "Inspect production: report ready",
  },
  {
    reportType: "agent-task",
    title: "Agent Task: Inspect production",
    execution: "complete",
    verdict: "attention",
    expected: "Action needed: Inspect production",
  },
  {
    reportType: "agent-task",
    title: "Agent Task: Inspect production",
    execution: "failed",
    verdict: "attention",
    expected: "Inspect production could not finish",
  },
  {
    reportType: "agent-task",
    title: "Production audit: Inspect production",
    execution: "complete",
    verdict: "clear",
    expected: "Inspect production: report ready",
  },
  {
    reportType: "agent-task",
    title: "Agent Task: Inspect production",
    execution: "complete",
    verdict: "pending",
    expected: "Inspect production could not finish",
  },
  {
    reportType: "ci-io-impact",
    title: "CI I/O optimization impact",
    execution: "complete",
    verdict: "clear",
    expected: "CI I/O report is ready",
  },
  {
    reportType: "ci-io-impact",
    title: "CI I/O optimization impact",
    execution: "complete",
    verdict: "pending",
    expected: "CI I/O report is still pending",
  },
  {
    reportType: "ci-io-impact",
    title: "CI I/O optimization impact",
    execution: "complete",
    verdict: "attention",
    expected: "Action needed: CI I/O target missed",
  },
  {
    reportType: "dependency-summary",
    title: "Weekly dependency summary",
    execution: "complete",
    verdict: "clear",
    expected: "Dependencies are up to date",
  },
  {
    reportType: "dependency-summary",
    title: "Weekly dependency summary",
    execution: "complete",
    verdict: "changed",
    expected: "Dependency changes found",
  },
  {
    reportType: "dependency-summary",
    title: "Weekly dependency summary",
    execution: "partial",
    verdict: "changed",
    expected: "Dependency report could not finish",
  },
  {
    reportType: "homelab-audit",
    title: "Daily homelab audit",
    execution: "complete",
    verdict: "clear",
    expected: "Your homelab looks healthy",
  },
  {
    reportType: "homelab-audit",
    title: "Daily homelab audit",
    execution: "complete",
    verdict: "attention",
    expected: "Action needed: homelab issues found",
  },
  {
    reportType: "homelab-audit",
    title: "Daily homelab audit",
    execution: "failed",
    verdict: "inconclusive",
    expected: "Homelab check failed",
  },
  {
    reportType: "link-rot-scan",
    title: "Weekly link-rot scan of main",
    execution: "complete",
    verdict: "clear",
    expected: "No broken links found",
  },
  {
    reportType: "link-rot-scan",
    title: "Weekly link-rot scan of main",
    execution: "complete",
    verdict: "attention",
    expected: "Broken or unreachable links found",
  },
  {
    reportType: "link-rot-scan",
    title: "Weekly link-rot scan of main",
    execution: "failed",
    verdict: "inconclusive",
    expected: "Link check failed",
  },
  {
    reportType: "main-vuln-scan",
    title: "Weekly Trivy vulnerability scan of main",
    execution: "complete",
    verdict: "clear",
    expected: "No high-risk vulnerabilities found",
  },
  {
    reportType: "main-vuln-scan",
    title: "Weekly Trivy vulnerability scan of main",
    execution: "complete",
    verdict: "attention",
    expected: "Action needed: vulnerabilities found",
  },
  {
    reportType: "main-vuln-scan",
    title: "Weekly Trivy vulnerability scan of main",
    execution: "failed",
    verdict: "inconclusive",
    expected: "Vulnerability scan failed",
  },
  {
    reportType: "protobufjs-v8-watch",
    title: "Temporal protobufjs v8 compatibility",
    execution: "complete",
    verdict: "pending",
    expected: "Temporal still uses protobufjs v7",
  },
  {
    reportType: "protobufjs-v8-watch",
    title: "Temporal protobufjs v8 compatibility",
    execution: "complete",
    verdict: "attention",
    expected: "Temporal can move to protobufjs v8",
  },
  {
    reportType: "protobufjs-v8-watch",
    title: "Temporal protobufjs v8 compatibility",
    execution: "failed",
    verdict: "inconclusive",
    expected: "protobufjs compatibility check failed",
  },
  {
    reportType: "scout-data-dragon",
    title: "Scout Data Dragon version-check",
    execution: "complete",
    verdict: "clear",
    expected: "Scout data is up to date",
  },
  {
    reportType: "scout-data-dragon",
    title: "Scout Data Dragon weekly-refresh",
    execution: "complete",
    verdict: "changed",
    expected: "Scout Data Dragon update created",
  },
  {
    reportType: "scout-data-dragon",
    title: "Scout Data Dragon weekly-refresh",
    execution: "partial",
    verdict: "attention",
    expected: "Scout Data Dragon update needs attention",
  },
  {
    reportType: "scout-lane-priors",
    title: "Scout lane-prior refresh",
    execution: "complete",
    verdict: "clear",
    expected: "Scout lane data is up to date",
  },
  {
    reportType: "scout-lane-priors",
    title: "Scout lane-prior refresh",
    execution: "complete",
    verdict: "changed",
    expected: "Scout lane-data update created",
  },
  {
    reportType: "scout-lane-priors",
    title: "Scout lane-prior refresh",
    execution: "failed",
    verdict: "inconclusive",
    expected: "Scout lane-data update failed",
  },
  {
    reportType: "scout-queue-windows",
    title: "Scout queue windows",
    execution: "complete",
    verdict: "clear",
    expected: "Scout queue windows are up to date",
  },
  {
    reportType: "scout-queue-windows",
    title: "Scout queue windows",
    execution: "complete",
    verdict: "changed",
    expected: "Scout queue-window changes found",
  },
  {
    reportType: "scout-queue-windows",
    title: "Scout queue windows",
    execution: "complete",
    verdict: "attention",
    expected: "Action needed: Scout queue-window warnings",
  },
  {
    reportType: "scout-season-refresh",
    title: "Scout season schedule",
    execution: "complete",
    verdict: "clear",
    expected: "Scout season dates are up to date",
  },
  {
    reportType: "scout-season-refresh",
    title: "Scout season schedule",
    execution: "complete",
    verdict: "changed",
    expected: "Scout season-date update created",
  },
  {
    reportType: "scout-season-refresh",
    title: "Scout season schedule",
    execution: "failed",
    verdict: "inconclusive",
    expected: "Scout season-date update failed",
  },
  {
    reportType: "tasknotes-canary",
    title: "TaskNotes skipped-files canary",
    execution: "complete",
    verdict: "clear",
    expected: "TaskNotes looks healthy",
  },
  {
    reportType: "tasknotes-canary",
    title: "TaskNotes skipped-files canary",
    execution: "complete",
    verdict: "attention",
    expected: "Action needed: TaskNotes problem found",
  },
  {
    reportType: "tasknotes-canary",
    title: "TaskNotes skipped-files canary",
    execution: "failed",
    verdict: "inconclusive",
    expected: "TaskNotes check failed",
  },
] satisfies SubjectCase[];

describe("ReportEnvelopeV1", () => {
  test("derives tailored human subjects for every report type", () => {
    for (const subjectCase of SUBJECT_CASES) {
      expect(
        reportSubject({
          ...validReport(),
          reportType: subjectCase.reportType,
          title: subjectCase.title,
          execution: subjectCase.execution,
          verdict: subjectCase.verdict,
        }),
      ).toBe(subjectCase.expected);
    }
    expect(TAILORED_REPORT_TYPES).toHaveLength(12);
    expect(TAILORED_REPORT_TYPES.every(hasTailoredReportPresentation)).toBe(
      true,
    );
  });

  test("keeps unknown report types readable", () => {
    expect(
      reportSubject({
        ...validReport(),
        reportType: "future-report",
        title: "Future check",
        verdict: "attention",
      }),
    ).toBe("Action needed: Future check");
  });

  test("translates internal states into human status labels", () => {
    expect(
      presentReport({
        ...validReport(),
        reportType: "ci-io-impact",
        verdict: "pending",
      }).statusLabel,
    ).toBe("Check incomplete");
    expect(
      presentReport({
        ...validReport(),
        reportType: "protobufjs-v8-watch",
        verdict: "pending",
      }).statusLabel,
    ).toBe("No action needed");
    expect(
      presentReport({
        ...validReport(),
        verdict: "attention",
      }).statusLabel,
    ).toBe("Review needed");
  });

  test("includes retirement recommendations when selecting review tone", () => {
    const presentation = presentReport({
      ...validReport(),
      reportType: "ci-io-impact",
      retirementRecommendation: "Retire the temporary CI I/O comparison.",
    });

    expect(presentation.statusLabel).toBe("Review needed");
    expect(presentation.actions).toEqual([
      "Retire the temporary CI I/O comparison.",
    ]);
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
});

describe("Human report email rendering", () => {
  test("renders facts first and escapes HTML", () => {
    const report = validReport();
    report.headline = "No <unsafe> changes";
    const html = renderReportHtml(report);
    const text = renderReportText(report);
    expect(html).toContain("No &lt;unsafe&gt; changes");
    expect(html).not.toContain("<unsafe>");
    expect(
      text.startsWith(
        "Dependencies are up to date\nNo action needed\nNo <unsafe> changes",
      ),
    ).toBe(true);
    expect(text).toContain("Passed · Catalog diff");
    expect(text).not.toContain("git-diff");
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
    expect(html).toContain("Upstream upgrades");
    expect(html).toContain('href="https://example.com/evidence"');
    expect(html).toContain("View source");
    expect(text).toContain("Upstream upgrades");
    expect(text).toContain("https://example.com/evidence");
    expect(text).not.toContain("git-diff");
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
      'href="https://example.com/%22%20onmouseover=%22alert(1)"',
    );
    expect(html).not.toContain('" onmouseover="');
    expect(() =>
      ReportEnvelopeV1Schema.parse({
        ...report,
        evidence: [{ ...receipt, url: "javascript:alert(1)" }],
      }),
    ).toThrow();
  });

  test("puts human actions before findings and checks", () => {
    const report = validReport();
    report.verdict = "attention";
    report.actions = ["Review the dependency update."];
    report.findings = [
      {
        severity: "warning",
        summary: "An update needs review.",
        evidenceReceiptIds: ["git-diff"],
      },
    ];
    const html = renderReportHtml(report);
    const text = renderReportText(report);
    expect(html.indexOf("What you need to do")).toBeLessThan(
      html.indexOf("What was found"),
    );
    expect(html.indexOf("What was found")).toBeLessThan(
      html.indexOf("What was checked"),
    );
    expect(text.indexOf("What you need to do")).toBeLessThan(
      text.indexOf("What was found"),
    );
    expect(text.indexOf("What was found")).toBeLessThan(
      text.indexOf("What was checked"),
    );
  });

  test("gives incomplete reports a review path when actions are absent", () => {
    const report = validReport();
    report.execution = "partial";
    report.verdict = "attention";
    report.actions = [];

    const presentation = presentReport(report);
    const text = renderReportText(report);

    expect(presentation.actions).toEqual([
      "Open the workflow run and review the reported problem.",
    ]);
    expect(text).toContain("What you need to do");
    expect(text).not.toContain("No action is needed.");
  });

  test("gives attention reports a review path when actions are absent", () => {
    const report = validReport();
    report.verdict = "attention";
    report.actions = [];

    const presentation = presentReport(report);
    const text = renderReportText(report);

    expect(presentation.actions).toEqual([
      "Open the workflow run and review the reported issue.",
    ]);
    expect(text).toContain("What you need to do");
    expect(text).not.toContain("No action is needed.");
  });

  test("orders findings from critical to informational", () => {
    const report = validReport();
    report.verdict = "attention";
    report.findings = [
      {
        severity: "info",
        summary: "Informational finding",
        evidenceReceiptIds: ["git-diff"],
      },
      {
        severity: "critical",
        summary: "Critical finding",
        evidenceReceiptIds: ["git-diff"],
      },
      {
        severity: "warning",
        summary: "Warning finding",
        evidenceReceiptIds: ["git-diff"],
      },
    ];

    const text = renderReportText(report);
    expect(text.indexOf("Critical finding")).toBeLessThan(
      text.indexOf("Warning finding"),
    );
    expect(text.indexOf("Warning finding")).toBeLessThan(
      text.indexOf("Informational finding"),
    );
  });

  test("omits delivery internals and raw commands", () => {
    const html = renderReportHtml(validReport());
    const text = renderReportText(validReport());
    for (const rendered of [html, text]) {
      expect(rendered).not.toContain("dependency-summary:run-1");
      expect(rendered).not.toContain("deps-summary-weekly-2026-08-10");
      expect(rendered).not.toContain("run-1");
      expect(rendered).not.toContain("git diff old new");
      expect(rendered).not.toContain("git-diff");
      expect(rendered).not.toContain("required");
      expect(rendered).not.toContain("optional");
    }
  });

  test("renders an email-safe responsive shell", () => {
    const html = renderReportHtml(validReport());
    expect(html).toContain('lang="en"');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('role="presentation"');
    expect(html).toContain("max-width:640px");
    expect(html).not.toContain("<script");
  });

  test("keeps compact HTML and plain-text snapshots stable", () => {
    expect(renderReportHtml(validReport())).toMatchSnapshot();
    expect(renderReportText(validReport())).toMatchSnapshot();
  });
});
