import { describe, expect, test } from "vitest";
import { hubReportRunUrl } from "@shepherdjerred/ops-model/tool-links.ts";
import {
  hasTailoredReportPresentation,
  presentReport,
  reportEyebrow,
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
    expected: "Inspect production: Report ready",
  },
  {
    reportType: "agent-task",
    title: "Agent Task: Inspect production",
    execution: "complete",
    verdict: "attention",
    expected: "Inspect production: Action needed",
  },
  {
    reportType: "agent-task",
    title: "Agent Task: Inspect production",
    execution: "failed",
    verdict: "attention",
    expected: "Inspect production: Could not finish",
  },
  {
    reportType: "agent-task",
    title: "Production audit: Inspect production",
    execution: "complete",
    verdict: "clear",
    expected: "Inspect production: Report ready",
  },
  {
    reportType: "agent-task",
    title: "Agent Task: Inspect production",
    execution: "complete",
    verdict: "pending",
    expected: "Inspect production: Could not finish",
  },
  {
    reportType: "dependency-summary",
    title: "Weekly dependency summary",
    execution: "complete",
    verdict: "clear",
    expected: "Dependencies: Up to date",
  },
  {
    reportType: "dependency-summary",
    title: "Weekly dependency summary",
    execution: "complete",
    verdict: "changed",
    expected: "Dependencies: Updates available",
  },
  {
    reportType: "dependency-summary",
    title: "Weekly dependency summary",
    execution: "partial",
    verdict: "changed",
    expected: "Dependencies: Check incomplete",
  },
  {
    reportType: "git-backup",
    title: "Daily Git repository backup",
    execution: "complete",
    verdict: "clear",
    expected: "Git backup: All repositories backed up",
  },
  {
    reportType: "git-backup",
    title: "Daily Git repository backup",
    execution: "partial",
    verdict: "attention",
    expected: "Git backup: Partial backup needs review",
  },
  {
    reportType: "git-backup",
    title: "Daily Git repository backup",
    execution: "failed",
    verdict: "inconclusive",
    expected: "Git backup: Run failed",
  },
  {
    reportType: "homelab-audit",
    title: "Daily homelab audit",
    execution: "complete",
    verdict: "clear",
    expected: "Homelab check: All clear",
  },
  {
    reportType: "homelab-audit",
    title: "Daily homelab audit",
    execution: "complete",
    verdict: "attention",
    expected: "Homelab check: Issues need review",
  },
  {
    reportType: "homelab-audit",
    title: "Daily homelab audit",
    execution: "failed",
    verdict: "inconclusive",
    expected: "Homelab check: Run failed",
  },
  {
    reportType: "link-rot-scan",
    title: "Weekly link-rot scan of main",
    execution: "complete",
    verdict: "clear",
    expected: "Link check: All links reachable",
  },
  {
    reportType: "link-rot-scan",
    title: "Weekly link-rot scan of main",
    execution: "complete",
    verdict: "attention",
    expected: "Link check: Broken links found",
  },
  {
    reportType: "link-rot-scan",
    title: "Weekly link-rot scan of main",
    execution: "failed",
    verdict: "inconclusive",
    expected: "Link check: Run failed",
  },
  {
    reportType: "main-vuln-scan",
    title: "Weekly Trivy vulnerability scan of main",
    execution: "complete",
    verdict: "clear",
    expected: "Security scan: No high-risk issues",
  },
  {
    reportType: "main-vuln-scan",
    title: "Weekly Trivy vulnerability scan of main",
    execution: "complete",
    verdict: "attention",
    expected: "Security scan: Vulnerabilities need review",
  },
  {
    reportType: "main-vuln-scan",
    title: "Weekly Trivy vulnerability scan of main",
    execution: "failed",
    verdict: "inconclusive",
    expected: "Security scan: Run failed",
  },
  {
    reportType: "scout-data-dragon",
    title: "Scout Data Dragon version-check",
    execution: "complete",
    verdict: "clear",
    expected: "Scout update: Patch data up to date",
  },
  {
    reportType: "scout-data-dragon",
    title: "Scout Data Dragon weekly-refresh",
    execution: "complete",
    verdict: "changed",
    expected: "Scout update: Data Dragon PR opened",
  },
  {
    reportType: "scout-data-dragon",
    title: "Scout Data Dragon weekly-refresh",
    execution: "partial",
    verdict: "attention",
    expected: "Scout update: Data Dragon needs review",
  },
  {
    reportType: "scout-lane-priors",
    title: "Scout lane-prior refresh",
    execution: "complete",
    verdict: "clear",
    expected: "Scout lane data: Up to date",
  },
  {
    reportType: "scout-lane-priors",
    title: "Scout lane-prior refresh",
    execution: "complete",
    verdict: "changed",
    expected: "Scout lane data: Update PR opened",
  },
  {
    reportType: "scout-lane-priors",
    title: "Scout lane-prior refresh",
    execution: "failed",
    verdict: "inconclusive",
    expected: "Scout lane data: Update failed",
  },
  {
    reportType: "scout-queue-windows",
    title: "Scout queue windows",
    execution: "complete",
    verdict: "clear",
    expected: "Scout queues: Windows up to date",
  },
  {
    reportType: "scout-queue-windows",
    title: "Scout queue windows",
    execution: "complete",
    verdict: "changed",
    expected: "Scout queues: Window changes detected",
  },
  {
    reportType: "scout-queue-windows",
    title: "Scout queue windows",
    execution: "complete",
    verdict: "attention",
    expected: "Scout queues: Warnings need review",
  },
  {
    reportType: "scout-season-refresh",
    title: "Scout season schedule",
    execution: "complete",
    verdict: "clear",
    expected: "Scout season: Dates up to date",
  },
  {
    reportType: "scout-season-refresh",
    title: "Scout season schedule",
    execution: "complete",
    verdict: "changed",
    expected: "Scout season: Update PR opened",
  },
  {
    reportType: "scout-season-refresh",
    title: "Scout season schedule",
    execution: "failed",
    verdict: "inconclusive",
    expected: "Scout season: Update failed",
  },
  {
    reportType: "storm-promotion",
    title: "The Storm promotion summary",
    execution: "complete",
    verdict: "clear",
    expected: "The Storm promotion: All clear",
  },
  {
    reportType: "storm-promotion",
    title: "The Storm promotion summary",
    execution: "complete",
    verdict: "changed",
    expected: "The Storm promotion: Changes detected",
  },
  {
    reportType: "storm-promotion",
    title: "The Storm promotion summary",
    execution: "complete",
    verdict: "attention",
    expected: "The Storm promotion: Destinations need review",
  },
  {
    reportType: "storm-promotion",
    title: "The Storm promotion summary",
    execution: "complete",
    verdict: "pending",
    expected: "The Storm promotion: Still pending",
  },
  {
    reportType: "storm-promotion",
    title: "The Storm promotion summary",
    execution: "partial",
    verdict: "inconclusive",
    expected: "The Storm promotion: Could not finish",
  },
  {
    reportType: "storm-promotion",
    title: "The Storm promotion summary",
    execution: "failed",
    verdict: "inconclusive",
    expected: "The Storm promotion: Run failed",
  },
  {
    reportType: "tasknotes-canary",
    title: "TaskNotes skipped-files canary",
    execution: "complete",
    verdict: "clear",
    expected: "TaskNotes check: All clear",
  },
  {
    reportType: "tasknotes-canary",
    title: "TaskNotes skipped-files canary",
    execution: "complete",
    verdict: "attention",
    expected: "TaskNotes check: Issue needs review",
  },
  {
    reportType: "tasknotes-canary",
    title: "TaskNotes skipped-files canary",
    execution: "failed",
    verdict: "inconclusive",
    expected: "TaskNotes check: Run failed",
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
    expect(reportEyebrow("storm-promotion")).toBe("The Storm Promotion");
    expect(reportEyebrow("git-backup")).toBe("Git Backup");
  });

  test("derives PR-aware changed subjects when remediation includes a PR URL", () => {
    const remediation = {
      outcome: "pr-created" as const,
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/1",
      changedFiles: ["README.md"],
    };
    expect(
      reportSubject({
        ...validReport(),
        reportType: "link-rot-scan",
        verdict: "changed",
        remediation,
      }),
    ).toBe("Link check: Dead-link fix PR opened");
    expect(
      reportSubject({
        ...validReport(),
        reportType: "main-vuln-scan",
        verdict: "changed",
        remediation,
      }),
    ).toBe("Security scan: Vulnerability fix PR opened");
    expect(
      reportSubject({
        ...validReport(),
        reportType: "dependency-summary",
        verdict: "changed",
        remediation,
      }),
    ).toBe("Dependencies: Updates and release-note PR");
  });

  test("keeps unknown report types readable", () => {
    expect(
      reportSubject({
        ...validReport(),
        reportType: "future-report",
        title: "Future check",
        verdict: "attention",
      }),
    ).toBe("Future check: Action needed");
  });

  test("translates internal states into human status labels", () => {
    expect(
      presentReport({
        ...validReport(),
        reportType: "homelab-audit",
        verdict: "pending",
      }).statusLabel,
    ).toBe("Check incomplete");
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
      retirementRecommendation: "Retire the temporary comparison.",
    });

    expect(presentation.statusLabel).toBe("Review needed");
    expect(presentation.actions).toEqual(["Retire the temporary comparison."]);
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
  test("renders facts first, collapses passed checks, and avoids repeating 'No action is needed'", () => {
    const report = validReport();
    report.headline = "No <unsafe> changes";
    const html = renderReportHtml(report);
    const text = renderReportText(report);
    expect(html).toContain("No &lt;unsafe&gt; changes");
    expect(html).not.toContain("<unsafe>");
    expect(html).not.toContain("No action is needed");
    expect(html).toContain("1 checks passed:");
    expect(
      text.startsWith(
        "Repo Dependencies · No action needed\nDependencies: Up to date\n\nNo <unsafe> changes",
      ),
    ).toBe(true);
    expect(text).not.toContain("No action is needed");
    expect(text).toContain("1 checks passed: Catalog diff");
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
    expect(html.indexOf("Next step:")).toBeLessThan(html.indexOf("Findings"));
    expect(html.indexOf("Findings")).toBeLessThan(html.indexOf("Checks"));
    expect(text.indexOf("Next step:")).toBeLessThan(text.indexOf("Findings"));
    expect(text.indexOf("Findings")).toBeLessThan(text.indexOf("Checks"));

    report.actions = ["Review the update.", "Re-run verification."];
    const multiHtml = renderReportHtml(report);
    const multiText = renderReportText(report);
    expect(multiHtml).toContain("Next steps");
    expect(multiHtml).not.toContain("Next step:");
    expect(multiText).toContain(
      "Next steps\n- Review the update.\n- Re-run verification.",
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
    expect(text).toContain(
      "Next step: Open the workflow run and review the reported problem.",
    );
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
    expect(text).toContain(
      "Next step: Open the workflow run and review the reported issue.",
    );
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

  test("omits delivery internals and raw commands while linking Open in Hub", () => {
    const fixture = {
      ...validReport(),
      provenance: {
        ...validReport().provenance,
        runId: "workflow-internal-uuid",
      },
    };
    const html = renderReportHtml(fixture);
    const text = renderReportText(fixture);
    const expectedHubUrl = hubReportRunUrl(fixture.reportRunId);
    for (const rendered of [html, text]) {
      expect(rendered).toContain("Open in Hub");
      expect(rendered).toContain(expectedHubUrl);
      expect(rendered).not.toContain("dependency-summary:run-1");
      expect(rendered).not.toContain("deps-summary-weekly-2026-08-10");
      expect(rendered).not.toContain("workflow-internal-uuid");
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
    expect(html).toContain('meta name="color-scheme" content="light dark"');
    expect(html).toContain('role="presentation"');
    expect(html).toContain("max-width:620px");
    expect(html).not.toContain("<script");
  });

  test("keeps compact HTML and plain-text snapshots stable", () => {
    expect(renderReportHtml(validReport())).toMatchSnapshot();
    expect(renderReportText(validReport())).toMatchSnapshot();
  });
});

describe("Automated remediation email rendering", () => {
  test("renders automated remediation card and promotes PR link to primary action", () => {
    const remediation = {
      outcome: "pr-created" as const,
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/1",
      branchName: "automation/link-rot",
      autoMergeEnabled: true,
      changedFiles: ["README.md", "packages/temporal/README.md"],
      summary: "Replaced two permanently redirected documentation links.",
    };
    const report: ReportEnvelopeV1 = {
      ...validReport(),
      reportType: "link-rot-scan",
      verdict: "changed",
      provenance: {
        ...validReport().provenance,
        temporalUrl:
          "https://temporal-ui.tailnet-1a49.ts.net/namespaces/prod/workflows/link-rot-scan",
      },
      remediation,
    };
    const html = renderReportHtml(report);
    const text = renderReportText(report);
    expect(html).toContain("Automated remediation");
    expect(html).toContain("Auto-merge enabled");
    expect(html).toContain("2 files");
    expect(html).toContain("Review pull request");
    expect(html).toContain("Open in Hub");
    expect(html).toContain("View workflow run");
    expect(text).toContain(
      "Review pull request: https://github.com/shepherdjerred/monorepo/pull/1",
    );
    expect(text).toContain(
      `Open in Hub: ${hubReportRunUrl(report.reportRunId)}`,
    );

    const awaitingReviewHtml = renderReportHtml({
      ...report,
      remediation: {
        ...remediation,
        outcome: "pr-reused",
        autoMergeEnabled: false,
      },
    });
    expect(awaitingReviewHtml).toContain("Awaiting review");
    expect(awaitingReviewHtml).toContain("Remediation pull request updated");
  });
});
