import { describe, expect, test } from "vitest";
import {
  buildLinkRotExcerpt,
  parseLycheeReport,
  type LinkRotScanResult,
} from "./link-rot-scan.ts";
import {
  buildLinkRotFailureReport,
  buildLinkRotReport,
  countCriticalReportFindings,
} from "./link-rot-scan-report.ts";

// Mirrors real `lychee --format json` output (verified against lychee
// v0.24.2): counters plus per-source maps; `status.code` only present for
// HTTP-status failures, network errors carry text only.
const LYCHEE_FIXTURE = JSON.stringify({
  total: 120,
  unique: 118,
  successful: 115,
  unknown: 0,
  unsupported: 0,
  timeouts: 1,
  redirects: 0,
  remaps: 0,
  excludes: 2,
  errors: 2,
  cached: 0,
  success_map: {},
  error_map: {
    "packages/docs/wiki/src/content/docs/reference/homelab.md": [
      {
        url: "https://github.com/shepherdjerred/definitely-missing",
        status: { text: "Rejected status code: 404 Not Found", code: 404 },
        span: { line: 12, column: 1 },
        duration: { secs: 0, nanos: 5 },
      },
    ],
    "README.md": [
      {
        url: "https://gone.example-registry.dev/pkg",
        status: {
          text: "Network error: Connection failed.",
          details: "Connection failed",
        },
        span: { line: 3, column: 1 },
        duration: { secs: 2, nanos: 0 },
      },
      {
        url: "error:",
        status: {
          text: "Error building URL for \"/docs/overview/\": Cannot resolve root-relative link '/docs/overview/'",
          details:
            "Cannot resolve root-relative link '/docs/overview/': To resolve root-relative links in local files, provide a root dir",
        },
        span: { line: 8, column: 1 },
      },
    ],
  },
  timeout_map: {
    "packages/monarch/README.md": [
      {
        url: "https://slow.example-vendor.dev/docs",
        status: { text: "Timeout" },
        span: { line: 40, column: 9 },
        duration: { secs: 20, nanos: 0 },
      },
    ],
  },
  suggestion_map: {},
  redirect_map: {},
  excluded_map: {},
  duration: { secs: 90, nanos: 0 },
  detailed_stats: false,
});

describe("parseLycheeReport", () => {
  test("flattens error_map and timeout_map into typed links", () => {
    const parsed = parseLycheeReport(LYCHEE_FIXTURE);
    expect(parsed.totalLinks).toBe(120);
    expect(parsed.successfulLinks).toBe(115);
    expect(parsed.excludedLinks).toBe(2);
    expect(parsed.ignoredRootRelativeLinks).toBe(1);
    expect(parsed.deadLinks).toEqual([
      {
        url: "https://github.com/shepherdjerred/definitely-missing",
        source: "packages/docs/wiki/src/content/docs/reference/homelab.md",
        status: "Rejected status code: 404 Not Found",
        statusCode: 404,
        line: 12,
      },
      {
        url: "https://gone.example-registry.dev/pkg",
        source: "README.md",
        status: "Network error: Connection failed.",
        line: 3,
      },
    ]);
    expect(parsed.timedOutLinks).toEqual([
      {
        url: "https://slow.example-vendor.dev/docs",
        source: "packages/monarch/README.md",
        status: "Timeout",
        line: 40,
      },
    ]);
  });

  test("a clean scan parses to empty link lists", () => {
    const parsed = parseLycheeReport(
      JSON.stringify({
        total: 10,
        successful: 10,
        errors: 0,
        timeouts: 0,
        excludes: 0,
        error_map: {},
        timeout_map: {},
      }),
    );
    expect(parsed.deadLinks).toEqual([]);
    expect(parsed.ignoredRootRelativeLinks).toBe(0);
    expect(parsed.timedOutLinks).toEqual([]);
  });

  test("rejects non-JSON output instead of returning empty", () => {
    expect(() => parseLycheeReport("lychee panicked")).toThrow();
  });

  test("rejects a report missing the error map", () => {
    expect(() =>
      parseLycheeReport(JSON.stringify({ total: 1, successful: 1 })),
    ).toThrow();
  });
});

function scanResult(
  parsed: ReturnType<typeof parseLycheeReport>,
): LinkRotScanResult {
  return {
    observedAt: "2026-08-23T12:00:00.000Z",
    repoSha: "d9ea9584e0123456789abcdef0123456789abcde",
    command: "lychee --config lychee.toml --format json --no-progress .",
    exitCode: parsed.deadLinks.length === 0 ? 0 : 2,
    ...parsed,
    excerpt: buildLinkRotExcerpt(parsed),
  };
}

describe("buildLinkRotReport", () => {
  test("a clean scan is a clear, complete report with zero findings", () => {
    const report = buildLinkRotReport(
      "2026-08-23T11:55:00.000Z",
      scanResult({
        totalLinks: 10,
        successfulLinks: 10,
        excludedLinks: 0,
        ignoredRootRelativeLinks: 0,
        deadLinks: [],
        timedOutLinks: [],
      }),
    );
    expect(report.verdict).toBe("clear");
    expect(report.execution).toBe("complete");
    expect(report.findings).toEqual([]);
    expect(report.actions).toEqual([]);
    expect(countCriticalReportFindings(report)).toBe(0);
  });

  test("dead links become warning findings; timeouts become info findings", () => {
    const report = buildLinkRotReport(
      "2026-08-23T11:55:00.000Z",
      scanResult(parseLycheeReport(LYCHEE_FIXTURE)),
    );
    expect(report.verdict).toBe("attention");
    expect(report.findings.map((finding) => finding.severity)).toEqual([
      "warning",
      "warning",
      "info",
    ]);
    expect(report.findings[0]?.section).toBe("Dead links");
    expect(report.findings[0]?.summary).toContain(
      "https://github.com/shepherdjerred/definitely-missing",
    );
    expect(report.findings[0]?.detail).toContain(
      "packages/docs/wiki/src/content/docs/reference/homelab.md:12",
    );
    expect(report.checks[0]?.summary).toContain(
      "1 site-root-relative link was delegated",
    );
    expect(report.findings[2]?.section).toBe("Timed-out links");
    expect(report.findings[2]?.detail).toContain(
      "Retry the link or investigate its reachability",
    );
    expect(report.findings[2]?.detail).not.toContain("Fix the link");
    for (const finding of report.findings) {
      expect(finding.evidenceReceiptIds).toEqual(["lychee-scan"]);
    }
    // Dead links are warnings by policy — the symmetric Alertmanager path
    // publishes a resolve, never a page, for this report.
    expect(countCriticalReportFindings(report)).toBe(0);
    expect(report.headline).toContain("2 dead and 1 timed-out");
    expect(report.actions).toEqual([
      "Fix or replace each confirmed dead link, or record a justified exclusion in .lycheeignore.",
      "Retry timed-out links or investigate their reachability before treating them as dead or adding an exclusion.",
    ]);
  });

  test("a timeout-only result recommends retrying rather than excluding", () => {
    const report = buildLinkRotReport(
      "2026-08-23T11:55:00.000Z",
      scanResult({
        totalLinks: 1,
        successfulLinks: 0,
        excludedLinks: 0,
        ignoredRootRelativeLinks: 0,
        deadLinks: [],
        timedOutLinks: [
          {
            url: "https://example.com/slow",
            source: "README.md",
            status: "Timeout",
          },
        ],
      }),
    );

    expect(report.actions).toEqual([
      "Retry timed-out links or investigate their reachability before treating them as dead or adding an exclusion.",
    ]);
  });
});

describe("buildLinkRotFailureReport", () => {
  test("a failed scan reports failed execution with the error excerpt", () => {
    const report = buildLinkRotFailureReport(
      "2026-08-23T11:55:00.000Z",
      new Error("lychee exited 1: invalid config"),
    );
    expect(report.execution).toBe("failed");
    expect(report.verdict).toBe("inconclusive");
    expect(report.checks[0]?.status).toBe("failed");
    expect(report.evidence[0]?.excerpt).toContain("invalid config");
  });
});
