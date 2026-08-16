import { describe, expect, it } from "bun:test";
import {
  AGENT_TASK_CLAUDE_SCHEMA_FINGERPRINT,
  AGENT_TASK_CLAUDE_SCHEMA_VERSION,
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE,
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX,
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX_V2,
  AgentTaskOutputContractError,
  AgentTaskInputSchema,
  AgentTaskInputV2Schema,
} from "./agent-task.ts";
import { stripClaudeSchemaAnnotations } from "./agent-task-json-schema.ts";
import {
  agentTaskScheduleId,
  agentTaskWorkflowId,
} from "./agent-task-identifiers.ts";
import {
  parseAgentTaskResultPayload,
  parseAgentTaskStructuredOutput,
} from "./agent-task-output.ts";
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

  it("requires independently executed evidence collectors for new v2 inputs", () => {
    expect(() =>
      AgentTaskInputV2Schema.parse({
        ...baseInput,
        contractVersion: 2,
        checks: [
          {
            id: "service-health",
            label: "Service health",
            required: true,
            evidenceRequirement: "A successful health endpoint response.",
          },
        ],
      }),
    ).toThrow(/independently executed evidenceCollectors/);
  });

  it("requires source-defined expectations for new v2 collectors", () => {
    expect(() =>
      AgentTaskInputV2Schema.parse({
        ...baseInput,
        contractVersion: 2,
        checks: [
          {
            id: "service-health",
            label: "Service health",
            required: true,
            evidenceRequirement: "A successful health endpoint response.",
            evidenceCollectors: [
              {
                id: "health-command",
                kind: "command",
                argv: ["curl", "https://service.example.test/health"],
                output: "json",
              },
            ],
          },
        ],
      }),
    ).toThrow(/source-defined expectation/);
  });

  it("rejects type-incompatible JSON expectations", () => {
    expect(() =>
      AgentTaskInputV2Schema.parse({
        ...baseInput,
        contractVersion: 2,
        checks: [
          {
            id: "service-health",
            label: "Service health",
            required: true,
            evidenceRequirement: "A healthy JSON response.",
            evidenceCollectors: [
              {
                id: "health-command",
                kind: "command",
                argv: ["service-health", "--json"],
                output: "json",
                expectation: {
                  kind: "json",
                  assertions: [
                    {
                      path: ["healthy"],
                      operator: "gt",
                      expected: "healthy",
                      quantifier: "all",
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts legacy evidence criteria only through the replay decoder", () => {
    const legacyInput = {
      ...baseInput,
      contractVersion: 2,
      checks: [
        {
          id: "service-health",
          label: "Service health",
          required: true,
          evidenceRequirement: "A successful health endpoint response.",
          evidenceCriteria: [{ field: "command", includes: "/health" }],
          evidenceCollectors: [
            {
              id: "health-command",
              kind: "command",
              argv: ["curl", "https://service.example.test/health"],
              output: "json",
              expectation: { kind: "exit-code", passedExitCodes: [0] },
            },
          ],
        },
      ],
    };

    expect(AgentTaskInputSchema.parse(legacyInput).contractVersion).toBe(2);
    expect(() => AgentTaskInputV2Schema.parse(legacyInput)).toThrow(
      /evidenceCriteria is replay-only/,
    );
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

  it("changes generated identities when the v2 coverage contract changes", async () => {
    const first = AgentTaskInputSchema.parse({
      ...baseInput,
      contractVersion: 2,
      checks: [
        {
          id: "service-health",
          label: "Service health",
          required: true,
          evidenceRequirement: "A successful health endpoint response.",
        },
      ],
      runAt: "2026-05-31T09:00:00-07:00",
    });
    const second = AgentTaskInputSchema.parse({
      ...first,
      checks: [
        {
          id: "service-health",
          label: "Service health",
          required: true,
          evidenceRequirement: "A successful health response and pod list.",
        },
      ],
    });

    expect(await agentTaskWorkflowId(first)).not.toBe(
      await agentTaskWorkflowId(second),
    );
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

  it("generates an OpenAI-strict v2 schema for codex from the wire Zod schema", () => {
    expect(AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX_V2["type"]).toBe("object");
    assertStrictJsonSchemaObjects(AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX_V2);
  });
});

describe("Claude structured output contract", () => {
  it("generates a plain/optional schema for claude from the canonical Zod schema", () => {
    expect(AGENT_TASK_CLAUDE_SCHEMA_VERSION).toBe("draft-07-v1");
    expect(AGENT_TASK_CLAUDE_SCHEMA_FINGERPRINT).toMatch(/^[0-9a-f]{16}$/);
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

    const containsFormat = (value: unknown): boolean => {
      if (Array.isArray(value)) {
        return value.some((entry) => containsFormat(entry));
      }
      if (typeof value !== "object" || value === null) {
        return false;
      }
      return Object.entries(value).some(
        ([key, entry]) => key === "format" || containsFormat(entry),
      );
    };
    expect(containsFormat(AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE)).toBe(false);
  });

  it("preserves properties named like stripped schema annotations", () => {
    const schema = stripClaudeSchemaAnnotations(
      z.toJSONSchema(z.object({ format: z.string(), $schema: z.string() }), {
        target: "draft-7",
      }),
    );
    const properties = z
      .record(z.string(), z.unknown())
      .parse(z.record(z.string(), z.unknown()).parse(schema)["properties"]);

    expect(properties["format"]).toBeDefined();
    expect(properties["$schema"]).toBeDefined();
  });

  it("accepts schema-valid structured output from a native SDK run", () => {
    expect(
      parseAgentTaskStructuredOutput({
        provider: "claude",
        structuredOutput: { markdown: "Claude report" },
        contractVersion: 1,
        schemaFingerprint: AGENT_TASK_CLAUDE_SCHEMA_FINGERPRINT,
        finalText: "I returned the report payload.",
        redactExcerpt: (value) => value,
      }),
    ).toEqual({ markdown: "Claude report" });
  });

  it("rejects a completed run that returned no structured output", () => {
    try {
      parseAgentTaskStructuredOutput({
        provider: "claude",
        structuredOutput: undefined,
        contractVersion: 1,
        schemaFingerprint: AGENT_TASK_CLAUDE_SCHEMA_FINGERPRINT,
        finalText: "Here is prose instead of the contract.",
        redactExcerpt: (value) => value,
      });
      throw new Error("Expected a structured-output contract failure");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AgentTaskOutputContractError);
      if (!(error instanceof AgentTaskOutputContractError)) {
        throw error;
      }
      expect(error.reason).toBe("missing-structured-output");
      expect(error.diagnostics.schemaFingerprint).toMatch(/^[0-9a-f]{16}$/);
      expect(error.message).toContain("schemaFingerprint=");
    }
  });

  it("rejects semantically invalid structured output without prose fallback", () => {
    for (const structuredOutput of [
      null,
      [],
      "not an object",
      { markdown: "" },
    ]) {
      try {
        parseAgentTaskStructuredOutput({
          provider: "claude",
          structuredOutput,
          contractVersion: 1,
          schemaFingerprint: AGENT_TASK_CLAUDE_SCHEMA_FINGERPRINT,
          finalText: '{"markdown":"prose fallback must not be used"}',
          redactExcerpt: (value) => value,
        });
        throw new Error("Expected a structured-output contract failure");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(AgentTaskOutputContractError);
        if (!(error instanceof AgentTaskOutputContractError)) {
          throw error;
        }
        expect(error.reason).toBe("invalid-structured-output");
      }
    }
  });

  it("bounds and redacts the final-text excerpt it retains for diagnostics", () => {
    try {
      parseAgentTaskStructuredOutput({
        provider: "codex",
        structuredOutput: undefined,
        contractVersion: 1,
        schemaFingerprint: "0123456789abcdef",
        finalText: `token=supersecret-token ${"x".repeat(400)}`,
        redactExcerpt: (text) =>
          text.replaceAll("supersecret-token", "[REDACTED]"),
      });
      throw new Error("Expected a structured-output contract failure");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AgentTaskOutputContractError);
      if (!(error instanceof AgentTaskOutputContractError)) {
        throw error;
      }
      expect(error.diagnostics.finalTextExcerpt).toContain("[REDACTED]");
      expect(error.diagnostics.finalTextExcerpt).not.toContain(
        "supersecret-token",
      );
      expect(error.diagnostics.finalTextExcerpt?.length).toBeLessThanOrEqual(
        241,
      );
    }
  });
});

describe("agent task payload normalization", () => {
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

  it("accepts the codex SDK's raw agent_message text (codex)", () => {
    // runCodexSdk deliberately assigns the final agent_message text verbatim to
    // `output`, leaving decoding to this contract step. That only works because
    // a string is JSON-parsed here before schema validation, so pin it: if this
    // ever stopped accepting a string, every Codex-backed agent task would fail
    // the output contract as a non-retryable AgentSdkOutputContractFailure.
    expect(
      parseAgentTaskResultPayload(
        JSON.stringify({
          markdown: "complete",
          followUp: null,
          cancelCron: null,
          cancelReason: null,
        }),
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
