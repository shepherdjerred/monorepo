import type { OtlpTrace } from "@shepherdjerred/ops-clients/tempo.ts";

import { FIXTURE_TRACE_IDS } from "./fixtures-data.ts";

function msToNanoString(ms: number): string {
  return `${String(Math.round(ms))}000000`;
}

export function buildClaudeCodexAndErrorTraces(
  t3Start: number,
  t4Start: number,
  t5Start: number,
): OtlpTrace[] {
  const claudeTrace: OtlpTrace = {
    traceId: FIXTURE_TRACE_IDS.claudeAgent,
    spans: [
      {
        traceId: FIXTURE_TRACE_IDS.claudeAgent,
        spanId: "3000000000000001",
        parentSpanId: null,
        name: "claude.agent pr-remediation",
        startTimeUnixNano: msToNanoString(t3Start),
        endTimeUnixNano: msToNanoString(t3Start + 18_400),
        status: "ok",
        statusMessage: null,
        serviceName: "temporal-agent-worker",
        scopeName: "llm.claude_agent",
        resourceAttributes: {
          "service.name": "temporal-agent-worker",
          "deployment.environment.name": "prod",
        },
        attributes: {
          "gen_ai.system": "claude_code_sdk",
          "llm.service": "temporal-agent-worker",
          "llm.call_site": "pr-remediation",
          "gen_ai.request.model": "claude-sonnet-5-5",
          "gen_ai.response.model": "claude-sonnet-5-5",
          "llm.claude_code.session_id": "sess_claude_01J9PR5041",
          "llm.claude_code.num_turns": 4,
          "llm.cost_usd": 0.18,
          temporalWorkflowId: "pr-remediation-5041",
          "llm.claude_code.options": {
            maxTurns: 6,
            permissionMode: "acceptEdits",
            allowedTools: ["Read", "Edit", "Bash"],
          },
          "gen_ai.usage.input_tokens": 8420,
          "gen_ai.usage.cache_read_input_tokens": 6100,
          "gen_ai.usage.cache_creation_input_tokens": 940,
          "gen_ai.usage.output_tokens": 1120,
          "gen_ai.input.messages": JSON.stringify([
            {
              role: "user",
              content:
                "Investigate failing Woodpecker typecheck on PR #5041 and push a targeted type narrowing fix.",
            },
          ]),
          "gen_ai.output.messages": JSON.stringify([
            {
              role: "assistant",
              parts: [
                {
                  type: "text",
                  text: "Inspecting packages/temporal/src/workflows/remediation.ts around nullable check status.",
                },
              ],
            },
            {
              role: "assistant",
              parts: [
                {
                  type: "tool_call",
                  id: "toolu_read_1",
                  name: "Edit",
                  arguments: {
                    file_path: "packages/temporal/src/workflows/remediation.ts",
                  },
                },
              ],
            },
            {
              role: "assistant",
              parts: [
                {
                  type: "text",
                  text: "Narrowed optional check conclusion before status comparison and verified tsc --noEmit passes.",
                },
              ],
            },
          ]),
          "llm.archive.s3_bucket": "llm-archive",
          "llm.archive.s3_key": `llm/temporal-agent-worker/claude_code_sdk/2026/11/24/${FIXTURE_TRACE_IDS.claudeAgent}-3000000000000001.json.gz`,
          "llm.archive.sha256":
            "ccddeeff00112233445566778899aabbccddeeff00112233445566778899aabb",
          "llm.archive.bytes_compressed": 2190,
          "llm.archive.bytes_uncompressed": 7430,
          "llm.archive.status": "ok",
        },
        events: [],
      },
    ],
  };

  const codexRes = {
    "service.name": "discord-plays-pokemon",
    "deployment.environment.name": "prod",
  };
  const codexTrace: OtlpTrace = {
    traceId: FIXTURE_TRACE_IDS.codexAgent,
    spans: [
      {
        traceId: FIXTURE_TRACE_IDS.codexAgent,
        spanId: "4000000000000001",
        parentSpanId: null,
        name: "pokemon.goal.run",
        startTimeUnixNano: msToNanoString(t4Start),
        endTimeUnixNano: msToNanoString(t4Start + 9600),
        status: "ok",
        statusMessage: null,
        serviceName: "discord-plays-pokemon",
        scopeName: "llm.codex",
        resourceAttributes: codexRes,
        attributes: {
          "gen_ai.system": "codex_sdk",
          "llm.service": "discord-plays-pokemon",
          "llm.call_site": "pokemon-goal-runner",
          "gen_ai.request.model": "gpt-5.3-codex",
          "gen_ai.response.model": "gpt-5.3-codex",
        },
        events: [],
      },
      {
        traceId: FIXTURE_TRACE_IDS.codexAgent,
        spanId: "4000000000000002",
        parentSpanId: "4000000000000001",
        name: "pokemon.goal.turn",
        startTimeUnixNano: msToNanoString(t4Start + 40),
        endTimeUnixNano: msToNanoString(t4Start + 4100),
        status: "ok",
        statusMessage: null,
        serviceName: "discord-plays-pokemon",
        scopeName: "llm.codex",
        resourceAttributes: codexRes,
        attributes: {
          "gen_ai.system": "codex_sdk",
          "codex.turn_index": 1,
          "gen_ai.usage.input_tokens": 1840,
          "gen_ai.usage.cache_read_input_tokens": 1024,
          "gen_ai.usage.output_tokens": 310,
          "gen_ai.usage.reasoning_tokens": 120,
          "gen_ai.input.messages":
            "Navigate Red from Pewter City eastern exit toward Route 3.",
          "gen_ai.output.messages": JSON.stringify([
            "Reading emulator tile map and testing direct eastbound walk path.",
          ]),
          "llm.archive.s3_bucket": "llm-archive",
          "llm.archive.s3_key": `llm/discord-plays-pokemon/codex_sdk/2026/11/24/${FIXTURE_TRACE_IDS.codexAgent}-4000000000000002.json.gz`,
          "llm.archive.bytes_compressed": 1120,
          "llm.archive.bytes_uncompressed": 3480,
          "llm.archive.status": "ok",
        },
        events: [],
      },
      {
        traceId: FIXTURE_TRACE_IDS.codexAgent,
        spanId: "4000000000000003",
        parentSpanId: "4000000000000001",
        name: "pokemon.goal.tool",
        startTimeUnixNano: msToNanoString(t4Start + 1200),
        endTimeUnixNano: msToNanoString(t4Start + 1345),
        status: "ok",
        statusMessage: null,
        serviceName: "discord-plays-pokemon",
        scopeName: "llm.codex",
        resourceAttributes: codexRes,
        attributes: {
          "gen_ai.system": "codex_sdk",
          "codex.call_id": "cmd_state_01",
          "codex.command": "pokemon-ctl state --json",
          "codex.exit_code": 0,
          "codex.duration_ms": 145,
          "gen_ai.tool.stdout":
            '{"map":"PEWTER_CITY","x":36,"y":18,"badges":1,"partyHpPct":94}\n',
          "gen_ai.tool.stderr": "",
        },
        events: [],
      },
      {
        traceId: FIXTURE_TRACE_IDS.codexAgent,
        spanId: "4000000000000004",
        parentSpanId: "4000000000000001",
        name: "pokemon.goal.tool",
        startTimeUnixNano: msToNanoString(t4Start + 2600),
        endTimeUnixNano: msToNanoString(t4Start + 2910),
        status: "ok",
        statusMessage: null,
        serviceName: "discord-plays-pokemon",
        scopeName: "llm.codex",
        resourceAttributes: codexRes,
        attributes: {
          "gen_ai.system": "codex_sdk",
          "codex.call_id": "cmd_walk_02",
          "codex.command": "pokemon-ctl walk --to 40,18",
          "codex.exit_code": 1,
          "codex.duration_ms": 310,
          "gen_ai.tool.stdout": "Step 36,18 -> 37,18\n",
          "gen_ai.tool.stderr":
            "Error: path blocked by one-way ledge tile at (38, 18)\n",
        },
        events: [],
      },
      {
        traceId: FIXTURE_TRACE_IDS.codexAgent,
        spanId: "4000000000000005",
        parentSpanId: "4000000000000001",
        name: "pokemon.goal.turn",
        startTimeUnixNano: msToNanoString(t4Start + 4200),
        endTimeUnixNano: msToNanoString(t4Start + 9540),
        status: "ok",
        statusMessage: null,
        serviceName: "discord-plays-pokemon",
        scopeName: "llm.codex",
        resourceAttributes: codexRes,
        attributes: {
          "gen_ai.system": "codex_sdk",
          "codex.turn_index": 2,
          "gen_ai.usage.input_tokens": 2190,
          "gen_ai.usage.cache_read_input_tokens": 1600,
          "gen_ai.usage.output_tokens": 265,
          "gen_ai.usage.reasoning_tokens": 95,
          "gen_ai.input.messages":
            "Ledge blocked (38, 18). Reroute north via y=16 corridor onto Route 3.",
          "gen_ai.output.messages": JSON.stringify([
            "Rerouted north around the Pewter ledge and entered Route 3 at (0, 8).",
          ]),
        },
        events: [],
      },
    ],
  };

  const errorTrace: OtlpTrace = {
    traceId: FIXTURE_TRACE_IDS.erroredBirmel,
    spans: [
      {
        traceId: FIXTURE_TRACE_IDS.erroredBirmel,
        spanId: "5000000000000001",
        parentSpanId: null,
        name: "gen_ai.chat discord-reply",
        startTimeUnixNano: msToNanoString(t5Start),
        endTimeUnixNano: msToNanoString(t5Start + 890),
        status: "error",
        statusMessage:
          "Anthropic 429 rate_limit_error: organization input token rate limit exceeded",
        serviceName: "birmel",
        scopeName: "ai",
        resourceAttributes: {
          "service.name": "birmel",
          "deployment.environment.name": "prod",
        },
        attributes: {
          "gen_ai.system": "anthropic",
          "llm.service": "birmel",
          "llm.call_site": "discord-reply",
          "gen_ai.request.model": "claude-sonnet-5-5",
          "llm.subject.kind": "discord_guild",
          "llm.subject.id": "guild_general_chat",
          "gen_ai.usage.input_tokens": 640,
          "gen_ai.usage.output_tokens": 0,
          "gen_ai.input.messages": JSON.stringify([
            {
              role: "user",
              content: "@birmel summarize the last 30 messages in #homelab-ops",
            },
          ]),
        },
        events: [
          {
            name: "exception",
            timeUnixNano: msToNanoString(t5Start + 885),
            attributes: {
              "exception.type": "APICallError",
              "exception.message":
                "429 rate_limit_error: organization input token rate limit exceeded",
            },
          },
        ],
      },
    ],
  };

  return [claudeTrace, codexTrace, errorTrace];
}
