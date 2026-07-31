import { describe, expect, it } from "bun:test";
import {
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE,
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX,
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
  it("generates an OpenAI-strict schema for codex from the wire Zod schema", () => {
    expect(AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX["type"]).toBe("object");
    expect(AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX["anyOf"]).toBeUndefined();
    assertStrictJsonSchemaObjects(AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX);
  });

  it("generates a plain/optional schema for claude from the canonical Zod schema", () => {
    expect(AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE["type"]).toBe("object");
    expect(AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE["$schema"]).toBeUndefined();
    expect(AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE["required"]).toEqual([
      "markdown",
    ]);
    const properties = z
      .record(z.string(), z.unknown())
      .parse(AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE["properties"]);
    const followUp = z
      .record(z.string(), z.unknown())
      .parse(properties["followUp"]);
    expect(followUp["required"]).toEqual(["title", "prompt"]);
    // regression guard: must not look like the OpenAI-strict/nullable dialect
    expect(JSON.stringify(AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE)).not.toContain(
      '"anyOf"',
    );
    expect(AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE).not.toEqual(
      AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX,
    );
  });

  it("normalizes a minimal nullable wire payload (codex)", () => {
    expect(
      parseAgentTaskResultPayload(
        {
          markdown: "complete",
          followUp: null,
          cancelCron: null,
          cancelReason: null,
        },
        "codex",
      ),
    ).toEqual({ markdown: "complete" });
  });

  it("parses a minimal plain payload directly (claude)", () => {
    expect(
      parseAgentTaskResultPayload({ markdown: "claude minimal" }, "claude"),
    ).toEqual({ markdown: "claude minimal" });
  });

  it("parses a fully-populated plain payload directly (claude)", () => {
    const payload = {
      markdown: "claude complete",
      followUp: {
        title: "Recheck",
        prompt: "Inspect the current state.",
        provider: "claude" as const,
        runAt: "2026-08-01T09:00:00-07:00",
        model: "claude-opus-5",
        maxTurns: 20,
        agentTimeoutMinutes: 15,
      },
      cancelCron: false,
      cancelReason: "not cancelled",
    };
    expect(parseAgentTaskResultPayload(payload, "claude")).toEqual(payload);
  });

  it("rejects a claude follow-up missing both schedule fields", () => {
    expect(() =>
      parseAgentTaskResultPayload(
        {
          markdown: "invalid",
          followUp: { title: "Recheck", prompt: "Inspect." },
        },
        "claude",
      ),
    ).toThrow(/must set runAt or cron/);
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
      parseAgentTaskResultPayload(
        {
          markdown: "one-off",
          followUp: {
            ...common,
            runAt: "2026-08-01T09:00:00-07:00",
            cron: null,
          },
          cancelCron: false,
          cancelReason: null,
        },
        "codex",
      ),
    ).toEqual({
      markdown: "one-off",
      followUp: {
        ...common,
        runAt: "2026-08-01T09:00:00-07:00",
      },
      cancelCron: false,
    });
    expect(
      parseAgentTaskResultPayload(
        {
          markdown: "recurring",
          followUp: {
            ...common,
            runAt: null,
            cron: "0 9 * * 1",
          },
          cancelCron: true,
          cancelReason: "Final report passed.",
        },
        "codex",
      ),
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
        parseAgentTaskResultPayload(
          {
            markdown: "invalid",
            followUp: { ...invalidFollowUp, ...schedule },
            cancelCron: null,
            cancelReason: null,
          },
          "codex",
        ),
      ).toThrow(/exactly one/);
    }
  });

  it("rejects omitted wire keys and empty output", () => {
    expect(() =>
      parseAgentTaskResultPayload({ markdown: "missing null keys" }, "codex"),
    ).toThrow(/Failed to parse/);
    expect(() => parseAgentTaskResultPayload("", "claude")).toThrow(
      /no structured output/,
    );
  });
});
