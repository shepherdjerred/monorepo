import { describe, expect, it } from "bun:test";
import {
  buildAuditEmailSubject,
  extractAuditSubjectCounts,
  renderAuditMarkdownToHtml,
} from "./markdown-to-html.ts";

describe("renderAuditMarkdownToHtml", () => {
  it("wraps output in a complete HTML document with inlined styles", () => {
    const html = renderAuditMarkdownToHtml("# hello\n\nbody");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<style>");
    expect(html).toContain("font-family");
    expect(html).toContain("<h1>hello</h1>");
    expect(html).toContain("<p>body</p>");
  });

  it("renders GFM tables (audit health matrix shape)", () => {
    const md = [
      "| App | Status |",
      "| --- | --- |",
      "| `bugsink` | 🟡 |",
      "| `argocd` | 🟢 |",
      "",
    ].join("\n");
    const html = renderAuditMarkdownToHtml(md);
    expect(html).toMatch(/<table>/);
    expect(html).toMatch(/<th>App<\/th>/);
    expect(html).toMatch(/<td><code>bugsink<\/code><\/td>/);
    expect(html).toContain("🟡");
    expect(html).toContain("🟢");
  });

  it("preserves status emoji prefixes in headings", () => {
    const md = "## §1 Talos / Node — Yellow\n\nBody.";
    const html = renderAuditMarkdownToHtml(md);
    expect(html).toContain("Yellow");
    expect(html).toContain("Talos");
  });

  it("renders fenced code blocks", () => {
    const md = "```bash\nkubectl get nodes\n```";
    const html = renderAuditMarkdownToHtml(md);
    expect(html).toMatch(/<pre>/);
    expect(html).toContain("kubectl get nodes");
  });

  it("strips raw <script> and event-handler attributes from agent output", () => {
    const malicious = [
      "## Section",
      "",
      "<script>alert('xss')</script>",
      "",
      'Click <a href="javascript:alert(1)" onclick="alert(2)">here</a>.',
      "",
      '<img src=x onerror="alert(3)">',
    ].join("\n");
    const html = renderAuditMarkdownToHtml(malicious);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
    // Anchor element kept, but the dangerous href is dropped.
    expect(html).toContain(">here</a>");
  });

  it("autolinks bare URLs (gfm)", () => {
    const md = "See https://example.com/x for details.";
    const html = renderAuditMarkdownToHtml(md);
    expect(html).toContain('href="https://example.com/x"');
  });
});

describe("extractAuditSubjectCounts", () => {
  it("parses the runbook-shaped TL;DR line", () => {
    const md = [
      "## TL;DR",
      "",
      "- Application Health Matrix: 0 Red / 8 Yellow / 52 Green (60 ArgoCD apps)",
      "- Open PagerDuty incidents: 7 (down from 19)",
      "",
    ].join("\n");
    expect(extractAuditSubjectCounts(md)).toEqual({
      red: 0,
      yellow: 8,
      green: 52,
      openPd: 7,
    });
  });

  it("returns undefined when the matrix line is missing", () => {
    expect(extractAuditSubjectCounts("just some text")).toBeUndefined();
  });
});

describe("buildAuditEmailSubject", () => {
  it("includes counts when present", () => {
    expect(
      buildAuditEmailSubject("2026-05-09", {
        red: 0,
        yellow: 3,
        green: 57,
        openPd: 4,
      }),
    ).toBe("Homelab Audit 2026-05-09 — 0 Red, 3 Yellow, 57 Green | 4 open PD");
  });

  it("falls back to a generic subject when counts are unavailable", () => {
    const counts = extractAuditSubjectCounts("no audit shape here");
    expect(buildAuditEmailSubject("2026-05-09", counts)).toBe(
      "Homelab Audit 2026-05-09",
    );
  });
});
