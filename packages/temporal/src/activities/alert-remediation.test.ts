import { describe, expect, it } from "bun:test";
import {
  createAlertRemediationActivities,
  normalizeBugsinkIssue,
  normalizePagerDutyIncident,
} from "./alert-remediation-collect.ts";
import { existingPrFromSearch } from "./alert-remediation.ts";
import type { AlertRemediationRunCommandInput } from "./alert-remediation-runtime.ts";

describe("alertRemediationActivities", () => {
  it("normalizes PagerDuty incidents with stable fingerprints", () => {
    const alert = normalizePagerDutyIncident({
      id: "P123",
      title: "PVC storage high",
      status: "triggered",
      urgency: "high",
      html_url: "https://pagerduty.example/incidents/P123",
      service: { summary: "prometheus" },
    });

    expect(alert.source).toBe("pagerduty");
    expect(alert.fingerprint).toBe("pagerduty:P123");
    expect(alert.title).toBe("PVC storage high");
    expect(alert.severity).toBe("high");
  });

  it("normalizes Bugsink issues with project-scoped fingerprints", () => {
    const alert = normalizeBugsinkIssue({
      project: { id: 7, name: "Scout", slug: "scout" },
      issue: {
        id: "issue-1",
        project: 7,
        calculated_type: "TypeError",
        calculated_value: "Cannot read properties of undefined",
        transaction: "/match",
        last_seen: "2026-05-30T10:00:00Z",
        is_resolved: false,
        is_muted: false,
      },
    });

    expect(alert.source).toBe("bugsink");
    expect(alert.fingerprint).toBe("bugsink:scout:issue-1");
    expect(alert.title).toContain("scout: TypeError");
  });

  it("collects all active PagerDuty and Bugsink alerts through toolkit", async () => {
    const commands: string[][] = [];
    const activities = createAlertRemediationActivities({
      now: () => new Date("2026-05-30T12:00:00Z"),
      runCommand: async (input: AlertRemediationRunCommandInput) => {
        commands.push(input.command);
        const command = input.command.join(" ");
        if (command.startsWith("toolkit pd incidents")) {
          return JSON.stringify([
            {
              id: "P123",
              title: "PVC storage high",
              status: "triggered",
              urgency: "high",
            },
          ]);
        }
        if (command === "toolkit bugsink projects --json") {
          return JSON.stringify([{ id: 7, name: "Scout", slug: "scout" }]);
        }
        if (command.includes("toolkit bugsink issues")) {
          return JSON.stringify([
            {
              id: "issue-1",
              project: 7,
              calculated_type: "TypeError",
              calculated_value: "Cannot read properties of undefined",
              transaction: "/match",
              last_seen: "2026-05-30T10:00:00Z",
              is_resolved: false,
              is_muted: false,
            },
            {
              id: "muted-issue",
              project: 7,
              calculated_type: "Error",
              calculated_value: "Muted",
              transaction: "/match",
              last_seen: "2026-05-30T10:00:00Z",
              is_resolved: false,
              is_muted: true,
            },
          ]);
        }
        throw new Error(`unexpected command: ${command}`);
      },
    });

    const result = await activities.collectAlertRemediationAlerts({
      repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
      provider: "claude",
      concurrency: 3,
      maxTurns: 20,
      pagerDutyLimit: 10,
      bugsinkIssueLimit: 20,
    });

    expect(result.failures).toEqual([]);
    expect(result.alerts.map((alert) => alert.fingerprint)).toEqual([
      "pagerduty:P123",
      "bugsink:scout:issue-1",
    ]);
    expect(commands.length).toBe(3);
  });

  it("detects an existing remediation PR from GitHub search output", () => {
    const result = existingPrFromSearch(
      JSON.stringify([
        {
          number: 10,
          title: "fix(alert): scout",
          url: "https://github.com/shepherdjerred/monorepo/pull/10",
          isDraft: true,
          headRefName: "alert-remediation/bugsink/issue",
        },
      ]),
    );

    expect(result).toEqual({
      found: true,
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/10",
      branchName: "alert-remediation/bugsink/issue",
      title: "fix(alert): scout",
    });
  });
});
