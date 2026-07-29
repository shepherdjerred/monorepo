import { describe, expect, it } from "bun:test";
import {
  AGENT_TASK_OUTPUT_JSON_SCHEMA,
  AgentTaskInputSchema,
  agentTaskScheduleId,
  agentTaskWorkflowId,
  parseAgentTaskResultPayload,
} from "./agent-task.ts";
import { z } from "zod/v4";

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
      agentTimeoutMinutes: 8,
    });
    expect(parsed.cron).toBe("0 9 * * 1");
    expect(parsed.scheduleId).toBe("weekly-recheck");
    expect(parsed.agentTimeoutMinutes).toBe(8);
  });

  it("rejects agent timeout values above the supported activity cap", () => {
    expect(() =>
      AgentTaskInputSchema.parse({
        ...baseInput,
        agentTimeoutMinutes: 91,
      }),
    ).toThrow();
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

function assertStrictJsonSchemaObjects(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertStrictJsonSchemaObjects(item);
    }
    return;
  }
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  if (!record.success) {
    return;
  }
  const properties = z
    .record(z.string(), z.unknown())
    .safeParse(record.data["properties"]);
  if (record.data["type"] === "object" || properties.success) {
    expect(record.data["additionalProperties"]).toBe(false);
    expect(
      z.array(z.string()).parse(record.data["required"]).toSorted(),
    ).toEqual(
      Object.keys(properties.success ? properties.data : {}).toSorted(),
    );
  }
  for (const child of Object.values(record.data)) {
    assertStrictJsonSchemaObjects(child);
  }
}

describe("agent task structured output", () => {
  it("generates an OpenAI-strict schema from the wire Zod schema", () => {
    expect(AGENT_TASK_OUTPUT_JSON_SCHEMA["type"]).toBe("object");
    expect(AGENT_TASK_OUTPUT_JSON_SCHEMA["anyOf"]).toBeUndefined();
    assertStrictJsonSchemaObjects(AGENT_TASK_OUTPUT_JSON_SCHEMA);
  });

  it("normalizes a minimal nullable wire payload", () => {
    expect(
      parseAgentTaskResultPayload({
        markdown: "complete",
        followUp: null,
        cancelCron: null,
        cancelReason: null,
      }),
    ).toEqual({ markdown: "complete" });
  });

  it("normalizes complete one-off and recurring follow-ups", () => {
    const common = {
      title: "Recheck",
      prompt: "Inspect the current state.",
      provider: "codex" as const,
      model: "gpt-5.6-sol",
      maxTurns: 20,
      agentTimeoutMinutes: 15,
    };
    expect(
      parseAgentTaskResultPayload({
        markdown: "one-off",
        followUp: {
          ...common,
          runAt: "2026-08-01T09:00:00-07:00",
          cron: null,
        },
        cancelCron: false,
        cancelReason: null,
      }),
    ).toEqual({
      markdown: "one-off",
      followUp: {
        ...common,
        runAt: "2026-08-01T09:00:00-07:00",
      },
      cancelCron: false,
    });
    expect(
      parseAgentTaskResultPayload({
        markdown: "recurring",
        followUp: {
          ...common,
          runAt: null,
          cron: "0 9 * * 1",
        },
        cancelCron: true,
        cancelReason: "Final report passed.",
      }),
    ).toEqual({
      markdown: "recurring",
      followUp: {
        ...common,
        cron: "0 9 * * 1",
      },
      cancelCron: true,
      cancelReason: "Final report passed.",
    });
  });

  it("rejects follow-ups with both or neither schedule field", () => {
    const invalidFollowUp = {
      title: "Recheck",
      prompt: "Inspect.",
      provider: null,
      model: null,
      maxTurns: null,
      agentTimeoutMinutes: null,
    };
    for (const schedule of [
      { runAt: null, cron: null },
      { runAt: "2026-08-01T09:00:00-07:00", cron: "0 9 * * 1" },
    ]) {
      expect(() =>
        parseAgentTaskResultPayload({
          markdown: "invalid",
          followUp: { ...invalidFollowUp, ...schedule },
          cancelCron: null,
          cancelReason: null,
        }),
      ).toThrow(/exactly one/);
    }
  });

  it("rejects omitted wire keys and empty output", () => {
    expect(() =>
      parseAgentTaskResultPayload({ markdown: "missing null keys" }),
    ).toThrow(/Failed to parse/);
    expect(() => parseAgentTaskResultPayload("")).toThrow(
      /no structured output/,
    );
  });
});
