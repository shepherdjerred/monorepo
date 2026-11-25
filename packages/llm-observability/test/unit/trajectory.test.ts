import { expect, test } from "vitest";
import {
  normalizeArchivedTrace,
  normalizeOtlpTrace,
  type OtlpSpanShape,
} from "#src/trajectory.ts";
import type { ArchivedSpanIndexRow } from "@shepherdjerred/ops-model/llm-traces.ts";

const BASE_MS = 1_790_361_600_000;

function nsOffset(offsetMs: number): string {
  return `${String(BASE_MS + offsetMs)}000000`;
}

function makeSpan(
  overrides: Partial<OtlpSpanShape> & { spanId: string; name: string },
): OtlpSpanShape {
  return {
    traceId: "0102030405060708090a0b0c0d0e0f10",
    parentSpanId: null,
    startTimeUnixNano: nsOffset(0),
    endTimeUnixNano: nsOffset(100),
    status: "ok",
    statusMessage: null,
    serviceName: "scout-backend",
    scopeName: "@shepherdjerred/llm-observability",
    attributes: {},
    resourceAttributes: {
      "service.name": "scout-backend",
      "deployment.environment.name": "prod",
    },
    events: [],
    ...overrides,
  };
}

test("deduplicates RepositoryOpenTelemetry wrapper, inherits workload/model, avoids double-counting tokens, and marks repair siblings", () => {
  const spans: OtlpSpanShape[] = [
    makeSpan({
      spanId: "root-workflow",
      name: "temporal.activity.generateReport",
      startTimeUnixNano: nsOffset(0),
      endTimeUnixNano: nsOffset(900),
      attributes: {
        "temporal.workflow.id": "wf-match-42",
        "llm.subject.kind": "discord_user",
        "llm.subject.id": "160509172704739328",
      },
    }),
    makeSpan({
      spanId: "repo-wrapper",
      parentSpanId: "root-workflow",
      name: "gen_ai.chat",
      startTimeUnixNano: nsOffset(50),
      endTimeUnixNano: nsOffset(850),
      attributes: {
        "gen_ai.system": "openai",
        "gen_ai.provider.name": "openai",
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "gpt-6-luna",
        "llm.service": "scout-backend",
        "llm.call_site": "scout.match-report",
      },
    }),
    makeSpan({
      spanId: "sdk-op",
      parentSpanId: "repo-wrapper",
      name: "invoke_agent scout.match-report",
      startTimeUnixNano: nsOffset(60),
      endTimeUnixNano: nsOffset(840),
      attributes: {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.provider.name": "openai",
        "gen_ai.system_instructions": JSON.stringify([
          { type: "text", content: "Return valid JSON." },
        ]),
        "gen_ai.input.tools": JSON.stringify([
          { name: "fetchChampion", description: "Fetch stats" },
        ]),
        "gen_ai.usage.input_tokens": 500,
        "gen_ai.usage.output_tokens": 120,
      },
    }),
    makeSpan({
      spanId: "do-gen-1",
      parentSpanId: "sdk-op",
      name: "ai.generateObject.doGenerate",
      startTimeUnixNano: nsOffset(70),
      endTimeUnixNano: nsOffset(400),
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": "openai",
        "gen_ai.response.model": "gpt-6-luna-2026-06-01",
        "gen_ai.response.id": "chatcmpl-1",
        "gen_ai.response.finish_reasons": ["stop"],
        "gen_ai.usage.input_tokens": 200,
        "gen_ai.usage.output_tokens": 50,
        "gen_ai.usage.cache_read.input_tokens": 100,
        "gen_ai.input.messages": JSON.stringify([
          {
            role: "user",
            parts: [{ type: "text", content: "Summarize match 42" }],
          },
        ]),
        "gen_ai.output.messages": JSON.stringify([
          {
            role: "assistant",
            parts: [{ type: "text", content: "{bad json" }],
          },
        ]),
        "llm.archive.s3_bucket": "llm-archive",
        "llm.archive.s3_key":
          "llm/scout-backend/openai/2026/09/25/t-gen1.json.gz",
        "llm.archive.sha256": "deadbeef",
        "llm.archive.bytes_compressed": 300,
        "llm.archive.bytes_uncompressed": 800,
        "llm.archive.status": "ok",
      },
    }),
    makeSpan({
      spanId: "do-gen-2",
      parentSpanId: "sdk-op",
      name: "ai.generateObject.doGenerate",
      startTimeUnixNano: nsOffset(420),
      endTimeUnixNano: nsOffset(830),
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": "openai",
        "gen_ai.response.model": "gpt-6-luna-2026-06-01",
        "gen_ai.response.id": "chatcmpl-2",
        "gen_ai.response.finish_reasons": ["stop"],
        "gen_ai.usage.input_tokens": 300,
        "gen_ai.usage.output_tokens": 70,
        "gen_ai.input.messages": JSON.stringify([
          {
            role: "user",
            parts: [{ type: "text", content: "Repair JSON output" }],
          },
        ]),
        "gen_ai.output.messages": JSON.stringify([
          {
            role: "assistant",
            parts: [
              { type: "reasoning", content: "Fixing braces" },
              { type: "text", content: '{"winner":"blue"}' },
            ],
          },
        ]),
      },
    }),
  ];

  const detail = normalizeOtlpTrace({
    traceId: "0102030405060708090a0b0c0d0e0f10",
    trace: { traceId: "0102030405060708090a0b0c0d0e0f10", spans },
  });

  expect(detail.spanCount).toBe(5);
  expect(detail.llmCallCount).toBe(2);
  expect(detail.environment).toBe("prod");
  expect(detail.subject).toEqual({
    kind: "discord_user",
    id: "160509172704739328",
  });
  expect(detail.temporalWorkflowId).toBe("wf-match-42");
  expect(detail.workloads).toEqual(["scout.match-report"]);
  expect(detail.models).toEqual(["gpt-6-luna"]);
  expect(detail.totals.inputTokens).toBe(500);
  expect(detail.totals.outputTokens).toBe(120);
  expect(detail.totals.cachedInputTokens).toBe(100);
  expect(detail.totals.catalogCostUsd).toBeGreaterThan(0);
  expect(detail.totals.hasSubscriptionCalls).toBe(false);

  const [firstCall, secondCall] = detail.trajectory;
  expect(firstCall?.shape).toBe("ai-sdk-chat");
  expect(secondCall?.shape).toBe("ai-sdk-chat");
  if (
    firstCall?.shape === "ai-sdk-chat" &&
    secondCall?.shape === "ai-sdk-chat"
  ) {
    expect(firstCall.workload).toBe("scout.match-report");
    expect(firstCall.requestedModel).toBe("gpt-6-luna");
    expect(firstCall.systemInstructions).toBe("Return valid JSON.");
    expect(firstCall.toolsJson).toContain("fetchChampion");
    expect(firstCall.isRepairAttempt).toBe(false);
    expect(secondCall.isRepairAttempt).toBe(true);
    expect(secondCall.outputMessages[0]?.parts).toEqual([
      { kind: "reasoning", text: "Fixing braces" },
      { kind: "text", text: '{"winner":"blue"}' },
    ]);
  }

  expect(detail.waterfall.map((w) => [w.spanId, w.depth, w.offsetMs])).toEqual([
    ["root-workflow", 0, 0],
    ["repo-wrapper", 1, 50],
    ["sdk-op", 2, 60],
    ["do-gen-1", 3, 70],
    ["do-gen-2", 3, 420],
  ]);
  expect(detail.archiveRefs).toHaveLength(1);
  expect(detail.archiveRefs[0]?.s3Key).toBe(
    "llm/scout-backend/openai/2026/09/25/t-gen1.json.gz",
  );
});

test("summarizes ai-sdk-embed spans without raw float vectors", () => {
  const detail = normalizeOtlpTrace({
    traceId: "embed-trace",
    trace: {
      traceId: "embed-trace",
      spans: [
        makeSpan({
          spanId: "embed-wrapper",
          name: "gen_ai.embeddings",
          attributes: {
            "gen_ai.system": "openai",
            "gen_ai.operation.name": "embeddings",
            "gen_ai.request.model": "text-embedding-3-small",
            "llm.call_site": "memory.index",
          },
        }),
        makeSpan({
          spanId: "embed-leaf",
          parentSpanId: "embed-wrapper",
          name: "ai.embedMany.doEmbed",
          attributes: {
            "gen_ai.provider.name": "openai",
            "gen_ai.usage.input_tokens": 14,
            "ai.values": [
              JSON.stringify("first document chunk"),
              JSON.stringify("second document chunk"),
            ],
            "ai.embeddings": [
              JSON.stringify([0.12, -0.34, 0.56, 0.78]),
              JSON.stringify([0.11, -0.22, 0.33, 0.44]),
            ],
          },
        }),
      ],
    },
  });

  expect(detail.trajectory).toHaveLength(1);
  const embed = detail.trajectory[0];
  expect(embed?.shape).toBe("ai-sdk-embed");
  if (embed?.shape === "ai-sdk-embed") {
    expect(embed.workload).toBe("memory.index");
    expect(embed.inputCount).toBe(2);
    expect(embed.inputPreviews).toEqual([
      "first document chunk",
      "second document chunk",
    ]);
    expect(embed.dimensions).toBe(4);
    expect(embed.inputTokens).toBe(14);
  }
});

test("normalizes openai-decision spans and computes decision catalog cost", () => {
  const detail = normalizeOtlpTrace({
    traceId: "decision-trace",
    trace: {
      traceId: "decision-trace",
      spans: [
        makeSpan({
          spanId: "dec-1",
          name: "gen_ai.chat",
          serviceName: "birmel",
          attributes: {
            "gen_ai.system": "openai",
            "gen_ai.provider.name": "openai",
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": "gpt-6-luna",
            "gen_ai.response.model": "gpt-6-luna-2026-06-01",
            "gen_ai.response.id": "dec_abc",
            "llm.service": "birmel",
            "llm.call_site": "moderation.triage",
            "gen_ai.usage.input_tokens": 1000,
            "gen_ai.usage.output_tokens": 12,
            "gen_ai.usage.cache_read_input_tokens": 400,
            "gen_ai.system_instructions": JSON.stringify([
              { type: "input_text", text: "Classify Discord message." },
            ]),
            "gen_ai.input.messages": JSON.stringify({
              input: "Check out this link",
              questions: [
                { type: "predicate", name: "is_spam", instructions: "Spam?" },
                {
                  type: "choice",
                  name: "allow_post",
                  instructions: "Allow?",
                  choices: [{ value: true }, { value: false }],
                },
                {
                  type: "score",
                  name: "toxicity",
                  instructions: "Rate",
                  levels: [{ label: "low" }, { label: "high" }],
                },
                { type: "predicate", name: "refused_q", instructions: "?" },
              ],
            }),
            "gen_ai.output.messages": JSON.stringify([
              { type: "predicate", name: "is_spam", probability: 0.85 },
              {
                type: "choice",
                name: "allow_post",
                choice: false,
                confidence: 0.9,
                probabilities: [
                  { value: true, probability: 0.1 },
                  { value: false, probability: 0.9 },
                ],
              },
              {
                type: "score",
                name: "toxicity",
                score: 1.2,
                confidence: 0.8,
                probabilities: [
                  { label: "low", value: 1, probability: 0.8 },
                  { label: "high", value: 2, probability: 0.2 },
                ],
              },
              { type: "refusal", name: null },
            ]),
          },
        }),
      ],
    },
  });

  expect(detail.trajectory).toHaveLength(1);
  const dec = detail.trajectory[0];
  expect(dec?.shape).toBe("openai-decision");
  if (dec?.shape === "openai-decision") {
    expect(dec.systemInstructions).toBe("Classify Discord message.");
    expect(dec.catalogCostUsd).not.toBeNull();
    expect(dec.catalogCostUsd).toBeGreaterThan(0);
    expect(dec.answers).toEqual([
      { type: "predicate", name: "is_spam", probability: 0.85 },
      {
        type: "choice",
        name: "allow_post",
        choice: "false",
        confidence: 0.9,
        probabilities: [
          { label: "true", value: "true", probability: 0.1 },
          { label: "false", value: "false", probability: 0.9 },
        ],
      },
      {
        type: "score",
        name: "toxicity",
        score: 1.2,
        confidence: 0.8,
        probabilities: [
          { label: "low", value: 1, probability: 0.8 },
          { label: "high", value: 2, probability: 0.2 },
        ],
      },
      { type: "refusal", name: "refused_q" },
    ]);
  }
  expect(detail.totals.catalogCostUsd).toBeGreaterThan(0);
});

test("normalizes claude-agent turns and keeps notional subscription cost out of catalogCostUsd", () => {
  const detail = normalizeOtlpTrace({
    traceId: "claude-trace",
    trace: {
      traceId: "claude-trace",
      spans: [
        makeSpan({
          spanId: "claude-1",
          name: "gen_ai.chat",
          serviceName: "birmel",
          attributes: {
            "gen_ai.system": "claude_code_sdk",
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": "claude-sonnet-4-6",
            "gen_ai.response.model": "claude-sonnet-4-6",
            "gen_ai.response.id": "sess-99",
            "llm.claude_code.session_id": "sess-99",
            "llm.claude_code.num_turns": 2,
            "llm.claude_code.options": JSON.stringify({ maxTurns: 5 }),
            "llm.cost_usd": 0.0425,
            "llm.service": "birmel",
            "llm.call_site": "editor-claude",
            "gen_ai.usage.input_tokens": 1200,
            "gen_ai.usage.output_tokens": 350,
            "gen_ai.usage.cache_read_input_tokens": 800,
            "gen_ai.usage.cache_creation_input_tokens": 150,
            "gen_ai.input.messages": JSON.stringify([
              { role: "user", content: "Fix the failing lint rule" },
            ]),
            "gen_ai.output.messages": JSON.stringify([
              {
                role: "assistant",
                content: [
                  { type: "thinking", thinking: "Inspecting rule AST" },
                  {
                    type: "tool_use",
                    id: "tu_1",
                    name: "Read",
                    input: { file_path: "rule.ts" },
                  },
                  {
                    type: "tool_result",
                    tool_use_id: "tu_1",
                    content: "export const rule = {};",
                    is_error: false,
                  },
                ],
              },
              { role: "assistant", content: "Updated rule.ts successfully." },
            ]),
          },
        }),
      ],
    },
  });

  expect(detail.totals.catalogCostUsd).toBe(0);
  expect(detail.totals.notionalSubscriptionUsd).toBeCloseTo(0.0425, 6);
  expect(detail.totals.hasSubscriptionCalls).toBe(true);

  const item = detail.trajectory[0];
  expect(item?.shape).toBe("claude-agent");
  if (item?.shape === "claude-agent") {
    expect(item.costKind).toBe("subscription");
    expect(item.catalogCostUsd).toBeNull();
    expect(item.notionalCostUsd).toBe(0.0425);
    expect(item.sessionId).toBe("sess-99");
    expect(item.numTurns).toBe(2);
    expect(item.prompt).toBe("Fix the failing lint rule");
    expect(item.assistantTurns).toHaveLength(2);
    expect(item.assistantTurns[0]?.parts.map((p) => p.kind)).toEqual([
      "reasoning",
      "tool-call",
      "tool-result",
    ]);
    expect(item.assistantTurns[1]?.parts).toEqual([
      { kind: "text", text: "Updated rule.ts successfully." },
    ]);
  }
});

test("groups codex-agent run, turn, and tool spans with hydrated stdout/stderr", () => {
  const hydratedEnvelopes = new Map<string, Record<string, unknown>>([
    [
      "llm/dpp/codex_cli/2026/09/25/trace-tool1.json.gz",
      {
        "gen_ai.tool.stdout": "full hydrated pokemon state json",
        "gen_ai.tool.stderr": "minor warning",
      },
    ],
  ]);

  const detail = normalizeOtlpTrace({
    traceId: "codex-trace",
    hydratedEnvelopes,
    trace: {
      traceId: "codex-trace",
      spans: [
        makeSpan({
          spanId: "codex-run",
          name: "pokemon.goal.run",
          serviceName: "discord-plays-pokemon",
          startTimeUnixNano: nsOffset(0),
          endTimeUnixNano: nsOffset(500),
          attributes: {
            "gen_ai.system": "codex_cli",
            "gen_ai.request.model": "gpt-5.6-luna",
            "llm.service": "discord-plays-pokemon",
            "llm.call_site": "goal-runner",
          },
        }),
        makeSpan({
          spanId: "codex-turn-1",
          parentSpanId: "codex-run",
          name: "pokemon.goal.turn",
          startTimeUnixNano: nsOffset(10),
          endTimeUnixNano: nsOffset(490),
          attributes: {
            "pokemon.goal.turn_index": 1,
            "gen_ai.system": "codex_cli",
            "gen_ai.request.model": "gpt-5.6-luna",
            "llm.service": "discord-plays-pokemon",
            "llm.call_site": "goal-runner",
            "gen_ai.input.messages": "Beat Brock",
            "gen_ai.output.messages": JSON.stringify(["Walking north"]),
            "gen_ai.usage.input_tokens": 4000,
            "gen_ai.usage.cache_read_input_tokens": 3500,
            "gen_ai.usage.output_tokens": 120,
            "gen_ai.usage.reasoning_tokens": 45,
          },
        }),
        makeSpan({
          spanId: "codex-tool-1",
          parentSpanId: "codex-run",
          name: "pokemon.goal.tool",
          startTimeUnixNano: nsOffset(50),
          endTimeUnixNano: nsOffset(200),
          attributes: {
            "gen_ai.system": "codex_cli",
            "gen_ai.request.model": "gpt-5.6-luna",
            "llm.service": "discord-plays-pokemon",
            "llm.call_site": "goal-runner",
            "pokemon.tool.call_id": "call_1",
            "pokemon.tool.command": "pokemonctl state",
            "pokemon.tool.exit_code": 0,
            "pokemon.tool.duration_ms": 150,
            "pokemon.tool.stdout_snippet": "truncated...",
            "llm.archive.s3_key":
              "llm/dpp/codex_cli/2026/09/25/trace-tool1.json.gz",
          },
        }),
      ],
    },
  });

  expect(detail.trajectory).toHaveLength(1);
  expect(detail.totals.hasSubscriptionCalls).toBe(true);
  expect(detail.totals.catalogCostUsd).toBe(0);
  expect(detail.totals.inputTokens).toBe(4000);
  expect(detail.totals.reasoningTokens).toBe(45);

  const codex = detail.trajectory[0];
  expect(codex?.shape).toBe("codex-agent");
  if (codex?.shape === "codex-agent") {
    expect(codex.costKind).toBe("subscription");
    expect(codex.turns).toEqual([
      {
        spanId: "codex-turn-1",
        turnIndex: 1,
        prompt: "Beat Brock",
        assistantMessages: ["Walking north"],
        inputTokens: 4000,
        cachedInputTokens: 3500,
        outputTokens: 120,
        reasoningTokens: 45,
      },
    ]);
    expect(codex.commands).toEqual([
      {
        spanId: "codex-tool-1",
        callId: "call_1",
        command: "pokemonctl state",
        exitCode: 0,
        durationMs: 150,
        stdout: "full hydrated pokemon state json",
        stderr: "minor warning",
      },
    ]);
  }
});

test("reconstructs archived chat and codex traces from index rows and S3 envelopes", () => {
  const chatRows: ArchivedSpanIndexRow[] = [
    {
      s3Key: "llm/scout/openai/2026/05/01/t1-s1.json.gz",
      traceId: "archived-chat-1",
      spanId: "s1",
      capturedAtMs: 1_780_000_000_000,
      service: "scout-backend",
      provider: "openai",
      callSite: "match-summary",
      requestModel: "openai/gpt-5.4-mini",
      responseModel: "gpt-5.4-mini",
      responseId: "resp-arch-1",
      finishReason: "stop",
      inputTokens: 250,
      outputTokens: 60,
      cacheReadTokens: 100,
      cacheCreationTokens: 0,
      hasToolIo: false,
      bytesCompressed: 400,
      bytesUncompressed: 1100,
    },
  ];
  const chatEnvelopes = new Map<string, Record<string, unknown>>([
    [
      "llm/scout/openai/2026/05/01/t1-s1.json.gz",
      {
        "gen_ai.system_instructions": "Be concise.",
        "gen_ai.input.messages": [{ role: "user", content: "Summarize" }],
        "gen_ai.output.messages": [
          { role: "assistant", content: "Clean victory." },
        ],
      },
    ],
  ]);

  const chatDetail = normalizeArchivedTrace({
    traceId: "archived-chat-1",
    rows: chatRows,
    envelopes: chatEnvelopes,
  });
  expect(chatDetail.source).toBe("archive");
  expect(chatDetail.durationMs).toBeNull();
  expect(chatDetail.trajectory).toHaveLength(1);
  expect(chatDetail.trajectory[0]?.shape).toBe("ai-sdk-chat");
  expect(chatDetail.archiveRefs).toHaveLength(1);

  const codexRows: ArchivedSpanIndexRow[] = [
    {
      s3Key: "llm/dpp/codex_sdk/2026/05/01/t2-turn.json.gz",
      traceId: "archived-codex-1",
      spanId: "turn-1",
      capturedAtMs: 1_780_000_010_000,
      service: "temporal",
      provider: "codex_sdk",
      callSite: "agent-task",
      requestModel: "gpt-5.6-luna",
      responseModel: null,
      responseId: null,
      finishReason: null,
      inputTokens: 900,
      outputTokens: 80,
      cacheReadTokens: 500,
      cacheCreationTokens: 0,
      hasToolIo: false,
      bytesCompressed: 300,
      bytesUncompressed: 900,
    },
    {
      s3Key: "llm/dpp/codex_sdk/2026/05/01/t2-tool.json.gz",
      traceId: "archived-codex-1",
      spanId: "tool-1",
      capturedAtMs: 1_780_000_012_000,
      service: "temporal",
      provider: "codex_sdk",
      callSite: "agent-task",
      requestModel: "gpt-5.6-luna",
      responseModel: null,
      responseId: null,
      finishReason: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasToolIo: true,
      bytesCompressed: 200,
      bytesUncompressed: 600,
    },
  ];
  const codexEnvelopes = new Map<string, Record<string, unknown>>([
    [
      "llm/dpp/codex_sdk/2026/05/01/t2-turn.json.gz",
      {
        "gen_ai.input.messages": "Run diagnostics",
        "gen_ai.output.messages": ["Diagnostics green"],
      },
    ],
    [
      "llm/dpp/codex_sdk/2026/05/01/t2-tool.json.gz",
      {
        "gen_ai.tool.stdout": "ok\n",
        "gen_ai.tool.stderr": "",
      },
    ],
  ]);

  const codexDetail = normalizeArchivedTrace({
    traceId: "archived-codex-1",
    rows: codexRows,
    envelopes: codexEnvelopes,
  });
  expect(codexDetail.durationMs).toBe(2000);
  expect(codexDetail.trajectory).toHaveLength(1);
  const grouped = codexDetail.trajectory[0];
  expect(grouped?.shape).toBe("codex-agent");
  if (grouped?.shape === "codex-agent") {
    expect(grouped.turns).toHaveLength(1);
    expect(grouped.commands).toHaveLength(1);
    expect(grouped.commands[0]?.stdout).toBe("ok\n");
  }
});
