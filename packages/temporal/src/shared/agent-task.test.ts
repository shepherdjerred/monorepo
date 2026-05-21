import { describe, expect, it } from "bun:test";
import {
  AgentTaskInputSchema,
  agentTaskScheduleId,
  agentTaskWorkflowId,
} from "./agent-task.ts";

const baseInput = {
  title: "Recheck post-deploy metrics",
  prompt: "Inspect the current metrics and email a report.",
  provider: "claude",
  mode: "report-only",
  repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
};

describe("AgentTaskInputSchema", () => {
  it("accepts one-off report tasks", () => {
    const parsed = AgentTaskInputSchema.parse({
      ...baseInput,
      runAt: "2026-05-31T09:00:00-07:00",
    });
    expect(parsed.mode).toBe("report-only");
    expect(parsed.runAt).toBe("2026-05-31T09:00:00-07:00");
  });

  it("accepts recurring report tasks", () => {
    const parsed = AgentTaskInputSchema.parse({
      ...baseInput,
      cron: "0 9 * * 1",
      scheduleId: "weekly-recheck",
    });
    expect(parsed.cron).toBe("0 9 * * 1");
    expect(parsed.scheduleId).toBe("weekly-recheck");
  });

  it("rejects tasks that set both runAt and cron", () => {
    expect(() =>
      AgentTaskInputSchema.parse({
        ...baseInput,
        runAt: "2026-05-31T09:00:00-07:00",
        cron: "0 9 * * 1",
      }),
    ).toThrow(/must not set both/);
  });
});

describe("agent task ids", () => {
  it("builds stable one-off workflow ids", async () => {
    const input = AgentTaskInputSchema.parse({
      ...baseInput,
      runAt: "2026-05-31T09:00:00-07:00",
    });
    await expect(agentTaskWorkflowId(input)).resolves.toBe(
      await agentTaskWorkflowId(input),
    );
  });

  it("uses explicit schedule ids when provided", async () => {
    const input = AgentTaskInputSchema.parse({
      ...baseInput,
      cron: "0 9 * * 1",
      scheduleId: "weekly-recheck",
    });
    await expect(agentTaskScheduleId(input)).resolves.toBe("weekly-recheck");
  });
});
