import { describe, expect, test } from "vitest";
import { EARLY_SCHEDULES } from "#schedules/schedule-definitions-early.ts";
import { triggerFeedsRefreshWithDeps } from "./feeds.ts";

describe("triggerFeedsRefreshWithDeps", () => {
  test("posts bearer token to FEEDS_URL/internal/refresh and parses summary", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const result = await triggerFeedsRefreshWithDeps({
      env: {
        FEEDS_URL: "http://feeds.feeds.svc.cluster.local:7430/",
        FEEDS_MACHINE_TOKEN: "synthetic-token",
      },
      fetchImpl: (input, init) => {
        seenUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const headers = new Headers(init?.headers);
        seenAuth = headers.get("authorization") ?? "";
        return Promise.resolve(
          Response.json({
            skippedByFlag: false,
            polled: 68,
            notModified: 60,
            updated: 8,
            failed: 0,
            backedOff: 0,
            newEntries: 12,
            autoReadEntries: 3,
          }),
        );
      },
    });

    expect(seenUrl).toBe(
      "http://feeds.feeds.svc.cluster.local:7430/internal/refresh",
    );
    expect(seenAuth).toBe("Bearer synthetic-token");
    expect(result.polled).toBe(68);
    expect(result.newEntries).toBe(12);
  });

  test("declares feeds-refresh schedule on 30-minute cadence with initial candidate pause note", () => {
    const schedule = EARLY_SCHEDULES.find(
      (item) => item.id === "feeds-refresh",
    );
    expect(schedule).toMatchObject({
      id: "feeds-refresh",
      workflowType: "runFeedsRefreshWorkflow",
      args: [],
      timing: {
        kind: "cron",
        expression: "13,43 * * * *",
        timezone: "America/Los_Angeles",
      },
      catchupWindow: "5 minutes",
      workflowExecutionTimeout: "5 minutes",
    });
    expect(schedule?.initialPauseNote).toContain("100% candidate traffic");
  });
});
