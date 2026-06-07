import { describe, expect, it } from "bun:test";
import { reportOnlyPrompt } from "#shared/agent-task.ts";
import { buildAlertRemediationPrompt } from "./alert-remediation-command.ts";

describe("alert remediation prompt", () => {
  it("permits draft PR creation only for straightforward remediation", () => {
    const prompt = buildAlertRemediationPrompt(
      {
        provider: "claude",
        maxTurns: 20,
        repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
        alert: {
          source: "bugsink",
          fingerprint: "bugsink:scout:issue-1",
          title: "scout: TypeError",
          status: "unresolved",
          details: { projectSlug: "scout" },
        },
      },
      "/tmp/workdir",
    );

    expect(prompt).toContain("open one draft PR");
    expect(prompt).toContain("only when the fix is straightforward");
    expect(prompt).toContain("Never resolve PagerDuty incidents");
    expect(prompt).toContain("bugsink:scout:issue-1");
  });

  it("leaves the generic agent task prompt report-only", () => {
    const prompt = reportOnlyPrompt(
      {
        title: "Report",
        prompt: "Report status.",
        provider: "claude",
        mode: "report-only",
        repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
        allowSelfCancel: false,
      },
      "/tmp/workdir",
    );

    expect(prompt).toContain("This task is report-only");
    expect(prompt).toContain("Do not edit files");
    expect(prompt).toContain("open pull requests");
  });
});
