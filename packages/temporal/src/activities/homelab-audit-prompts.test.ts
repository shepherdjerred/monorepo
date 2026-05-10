import { describe, expect, it } from "bun:test";
import {
  buildAuditPrompt,
  filterRunbookSections,
} from "./homelab-audit-prompts.ts";

const SAMPLE_RUNBOOK = `# Homelab Audit Runbook

Preamble lives here.

## Prerequisites

Tools, etc.

## Section 1: Talos Node Health

talosctl health

## Section 2: Kubernetes Cluster Health

kubectl get nodes

## Section 9: Bugsink

toolkit bugsink issues

## Section 13: Application Health Matrix

argocd app list
`;

describe("filterRunbookSections", () => {
  it("returns the input unchanged for `all`", () => {
    expect(filterRunbookSections(SAMPLE_RUNBOOK, "all")).toBe(SAMPLE_RUNBOOK);
  });

  it("keeps the head and only the requested sections", () => {
    const filtered = filterRunbookSections(SAMPLE_RUNBOOK, [1, 13]);
    expect(filtered).toContain("Preamble lives here.");
    expect(filtered).toContain("Prerequisites");
    expect(filtered).toContain("## Section 1: Talos Node Health");
    expect(filtered).toContain("## Section 13: Application Health Matrix");
    expect(filtered).not.toContain("## Section 2:");
    expect(filtered).not.toContain("## Section 9:");
    expect(filtered).not.toContain("kubectl get nodes");
    expect(filtered).not.toContain("toolkit bugsink issues");
  });
});

describe("buildAuditPrompt", () => {
  it("embeds the runbook between BEGIN/END markers and pins the date", () => {
    const prompt = buildAuditPrompt({
      date: "2026-05-09",
      runbook: SAMPLE_RUNBOOK,
      sections: "all",
    });
    expect(prompt).toContain("Today is 2026-05-09");
    expect(prompt).toContain("<<< RUNBOOK BEGIN >>>");
    expect(prompt).toContain("<<< RUNBOOK END >>>");
    expect(prompt).toContain("## Section 1: Talos Node Health");
    expect(prompt).toContain("Application Health Matrix");
  });

  it("forbids state-mutating commands and PD acknowledgement", () => {
    const prompt = buildAuditPrompt({
      date: "2026-05-09",
      runbook: SAMPLE_RUNBOOK,
      sections: "all",
    });
    expect(prompt).toContain("NEVER mutate state");
    expect(prompt).toContain("kubectl apply");
    expect(prompt).toContain("tofu apply");
    expect(prompt).toContain("PagerDuty");
  });

  it("requires the subject-parsing TL;DR lines verbatim", () => {
    const prompt = buildAuditPrompt({
      date: "2026-05-09",
      runbook: SAMPLE_RUNBOOK,
      sections: "all",
    });
    // The subject parser depends on the exact "Application Health Matrix:" /
    // "Open PagerDuty incidents:" phrasing — if this slips, the email subject
    // falls back to a generic line.
    expect(prompt).toContain("Application Health Matrix:");
    expect(prompt).toContain("Open PagerDuty incidents:");
  });

  it("filters down to the requested sections only", () => {
    const prompt = buildAuditPrompt({
      date: "2026-05-09",
      runbook: SAMPLE_RUNBOOK,
      sections: [9],
    });
    expect(prompt).toContain("## Section 9: Bugsink");
    expect(prompt).not.toContain("## Section 1:");
    expect(prompt).not.toContain("## Section 13:");
  });
});
