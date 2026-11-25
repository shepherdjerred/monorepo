import type { OtlpTrace } from "@shepherdjerred/ops-clients/tempo.ts";

import { buildClaudeCodexAndErrorTraces } from "./fixtures-agent-traces.ts";
import { FIXTURE_TRACE_IDS } from "./fixtures-data.ts";

function msToNanoString(ms: number): string {
  return `${String(Math.round(ms))}000000`;
}

const MINUTE_MS = 60_000;

function buildAiSdkChatTrace(t1Start: number): OtlpTrace {
  const res = {
    "service.name": "scout-backend",
    "deployment.environment.name": "prod",
  };
  return {
    traceId: FIXTURE_TRACE_IDS.aiSdkChat,
    spans: [
      {
        traceId: FIXTURE_TRACE_IDS.aiSdkChat,
        spanId: "1000000000000001",
        parentSpanId: null,
        name: "POST /api/reviews/match",
        startTimeUnixNano: msToNanoString(t1Start),
        endTimeUnixNano: msToNanoString(t1Start + 4280),
        status: "ok",
        statusMessage: null,
        serviceName: "scout-backend",
        scopeName: "hono.http",
        resourceAttributes: res,
        attributes: {
          "http.request.method": "POST",
          "url.path": "/api/reviews/match",
          temporalWorkflowId: "scout-match-review-9912",
        },
        events: [],
      },
      {
        traceId: FIXTURE_TRACE_IDS.aiSdkChat,
        spanId: "1000000000000002",
        parentSpanId: "1000000000000001",
        name: "ai.generateObject match-review",
        startTimeUnixNano: msToNanoString(t1Start + 40),
        endTimeUnixNano: msToNanoString(t1Start + 4220),
        status: "ok",
        statusMessage: null,
        serviceName: "scout-backend",
        scopeName: "ai",
        resourceAttributes: res,
        attributes: {
          "gen_ai.system": "openai",
          "llm.service": "scout-backend",
          "llm.call_site": "match-review",
          "gen_ai.request.model": "gpt-6.1-sol",
          "llm.subject.kind": "tracked_player",
          "llm.subject.id": "puuid_faker",
        },
        events: [],
      },
      {
        traceId: FIXTURE_TRACE_IDS.aiSdkChat,
        spanId: "1000000000000003",
        parentSpanId: "1000000000000002",
        name: "gen_ai.chat",
        startTimeUnixNano: msToNanoString(t1Start + 60),
        endTimeUnixNano: msToNanoString(t1Start + 1310),
        status: "ok",
        statusMessage: null,
        serviceName: "scout-backend",
        scopeName: "ai",
        resourceAttributes: res,
        attributes: {
          "gen_ai.system": "openai",
          "llm.service": "scout-backend",
          "llm.call_site": "match-review",
          "gen_ai.request.model": "gpt-6.1-sol",
          "gen_ai.response.model": "gpt-6.1-sol",
          "gen_ai.response.id": "resp_chat_step1",
          "gen_ai.response.finish_reasons": ["tool-calls"],
          "gen_ai.usage.input_tokens": 1420,
          "gen_ai.usage.cache_read_input_tokens": 1024,
          "gen_ai.usage.output_tokens": 96,
          "gen_ai.system_instructions":
            "You are Scout's Challenger match analyst. Inspect objective timers via tools before grading macro play.",
          "gen_ai.input.tools": JSON.stringify([
            {
              name: "fetchMatchTimeline",
              description:
                "Fetch gold, XP, and Baron/Dragon frames for a Riot match ID",
            },
          ]),
          "gen_ai.input.messages": JSON.stringify([
            {
              role: "user",
              content:
                "Review match KR_7410293847 for mid-laner Azir (tracked_player:puuid_faker).",
            },
          ]),
          "gen_ai.output.messages": JSON.stringify([
            {
              role: "assistant",
              parts: [
                {
                  type: "tool_call",
                  id: "call_timeline_1",
                  name: "fetchMatchTimeline",
                  arguments: { matchId: "KR_7410293847", includeFrames: true },
                },
              ],
            },
          ]),
          "llm.archive.s3_bucket": "llm-archive",
          "llm.archive.s3_key": `llm/scout-backend/openai/2026/11/24/${FIXTURE_TRACE_IDS.aiSdkChat}-1000000000000003.json.gz`,
          "llm.archive.sha256":
            "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0",
          "llm.archive.bytes_compressed": 1284,
          "llm.archive.bytes_uncompressed": 4120,
          "llm.archive.status": "ok",
        },
        events: [],
      },
      {
        traceId: FIXTURE_TRACE_IDS.aiSdkChat,
        spanId: "1000000000000004",
        parentSpanId: "1000000000000002",
        name: "execute_tool fetchMatchTimeline",
        startTimeUnixNano: msToNanoString(t1Start + 1320),
        endTimeUnixNano: msToNanoString(t1Start + 1680),
        status: "ok",
        statusMessage: null,
        serviceName: "scout-backend",
        scopeName: "ai",
        resourceAttributes: res,
        attributes: {
          "gen_ai.operation.name": "execute_tool",
          "gen_ai.tool.name": "fetchMatchTimeline",
          "gen_ai.tool.call.id": "call_timeline_1",
        },
        events: [],
      },
      {
        traceId: FIXTURE_TRACE_IDS.aiSdkChat,
        spanId: "1000000000000005",
        parentSpanId: "1000000000000002",
        name: "gen_ai.chat",
        startTimeUnixNano: msToNanoString(t1Start + 1690),
        endTimeUnixNano: msToNanoString(t1Start + 2940),
        status: "ok",
        statusMessage: null,
        serviceName: "scout-backend",
        scopeName: "ai",
        resourceAttributes: res,
        attributes: {
          "gen_ai.system": "openai",
          "llm.service": "scout-backend",
          "llm.call_site": "match-review",
          "gen_ai.request.model": "gpt-6.1-sol",
          "gen_ai.response.model": "gpt-6.1-sol",
          "gen_ai.response.id": "resp_chat_step2",
          "gen_ai.response.finish_reasons": ["stop"],
          "gen_ai.usage.input_tokens": 2380,
          "gen_ai.usage.cache_read_input_tokens": 1408,
          "gen_ai.usage.output_tokens": 180,
          "gen_ai.input.messages": JSON.stringify([
            {
              role: "user",
              content:
                "Review match KR_7410293847 for mid-laner Azir (tracked_player:puuid_faker).",
            },
            {
              role: "tool",
              tool_call_id: "call_timeline_1",
              name: "fetchMatchTimeline",
              content: {
                goldDiffAt14: 1120,
                baronSecuredAtMin: 22.4,
                emperorDividePicks: 3,
              },
            },
          ]),
          "gen_ai.output.messages": JSON.stringify([
            {
              role: "assistant",
              content:
                '{"grade":"S","headline":"Clean side-lane pressure","timestampFrame":"missing-number"}',
            },
          ]),
        },
        events: [],
      },
      {
        traceId: FIXTURE_TRACE_IDS.aiSdkChat,
        spanId: "1000000000000006",
        parentSpanId: "1000000000000002",
        name: "gen_ai.chat.repair",
        startTimeUnixNano: msToNanoString(t1Start + 2955),
        endTimeUnixNano: msToNanoString(t1Start + 4210),
        status: "ok",
        statusMessage: null,
        serviceName: "scout-backend",
        scopeName: "ai",
        resourceAttributes: res,
        attributes: {
          "gen_ai.system": "openai",
          "llm.service": "scout-backend",
          "llm.call_site": "match-review",
          "gen_ai.request.model": "gpt-6.1-sol",
          "gen_ai.response.model": "gpt-6.1-sol",
          "gen_ai.response.id": "resp_chat_repair3",
          "gen_ai.response.finish_reasons": ["stop"],
          "llm.repair_attempt": true,
          "gen_ai.usage.input_tokens": 2610,
          "gen_ai.usage.cache_read_input_tokens": 2048,
          "gen_ai.usage.output_tokens": 215,
          "gen_ai.usage.reasoning_tokens": 64,
          "gen_ai.input.messages": JSON.stringify([
            {
              role: "user",
              content:
                "Schema validation failed at timestampFrame (expected number, received string). Emit corrected MatchReview JSON.",
            },
          ]),
          "gen_ai.output.messages": JSON.stringify([
            {
              role: "assistant",
              parts: [
                {
                  type: "reasoning",
                  text: "Converting Baron setup timestampFrame to integer minute 22.",
                },
                {
                  type: "text",
                  text: '{"grade":"S","headline":"Controlled mid prio into 22m Baron setup","timestampFrame":22}',
                },
              ],
            },
          ]),
          "llm.archive.s3_bucket": "llm-archive",
          "llm.archive.s3_key": `llm/scout-backend/openai/2026/11/24/${FIXTURE_TRACE_IDS.aiSdkChat}-1000000000000006.json.gz`,
          "llm.archive.sha256":
            "4a5b6c7d8e9f00112233445566778899aabbccddeeff00112233445566778899",
          "llm.archive.bytes_compressed": 1540,
          "llm.archive.bytes_uncompressed": 4890,
          "llm.archive.status": "ok",
        },
        events: [],
      },
    ],
  };
}

function buildDecisionTrace(t2Start: number): OtlpTrace {
  return {
    traceId: FIXTURE_TRACE_IDS.openAiDecision,
    spans: [
      {
        traceId: FIXTURE_TRACE_IDS.openAiDecision,
        spanId: "2000000000000001",
        parentSpanId: null,
        name: "runtime.decide dare-eligibility",
        startTimeUnixNano: msToNanoString(t2Start),
        endTimeUnixNano: msToNanoString(t2Start + 640),
        status: "ok",
        statusMessage: null,
        serviceName: "scout-backend",
        scopeName: "llm.decisions",
        resourceAttributes: {
          "service.name": "scout-backend",
          "deployment.environment.name": "prod",
        },
        attributes: {
          "gen_ai.system": "openai",
          "llm.service": "scout-backend",
          "llm.call_site": "dare-eligibility",
          "gen_ai.request.model": "gpt-6-luna",
          "gen_ai.response.model": "gpt-6-luna",
          "gen_ai.response.id": "dec_01J9DARE",
          "llm.subject.kind": "discord_user",
          "llm.subject.id": "21984712984",
          "gen_ai.usage.input_tokens": 920,
          "gen_ai.usage.cache_read_input_tokens": 512,
          "gen_ai.usage.output_tokens": 48,
          "gen_ai.system_instructions":
            "Evaluate ranked solo-queue context and assign calibrated Dare eligibility probabilities.",
          "gen_ai.input.messages": JSON.stringify({
            input: {
              discordUserId: "21984712984",
              champion: "Orianna",
              winStreak: 4,
              queue: "RANKED_SOLO_5x5",
            },
            questions: [
              { name: "eligible_for_dare", type: "predicate" },
              {
                name: "recommended_stake_tier",
                type: "choice",
                options: ["prismatic", "gold", "silver"],
              },
              { name: "difficulty_rating", type: "score", min: 1, max: 5 },
            ],
          }),
          "gen_ai.output.messages": JSON.stringify([
            {
              type: "predicate",
              name: "eligible_for_dare",
              probability: 0.91,
            },
            {
              type: "choice",
              name: "recommended_stake_tier",
              choice: "prismatic",
              confidence: 0.78,
              probabilities: [
                { label: "prismatic", value: "prismatic", probability: 0.78 },
                { label: "gold", value: "gold", probability: 0.17 },
                { label: "silver", value: "silver", probability: 0.05 },
              ],
            },
            {
              type: "score",
              name: "difficulty_rating",
              score: 4.3,
              confidence: 0.85,
              probabilities: [
                { label: "5 (Challenger)", value: 5, probability: 0.48 },
                { label: "4 (Master)", value: 4, probability: 0.37 },
                { label: "3 (Diamond)", value: 3, probability: 0.15 },
              ],
            },
          ]),
          "llm.archive.s3_bucket": "llm-archive",
          "llm.archive.s3_key": `llm/scout-backend/openai/2026/11/24/${FIXTURE_TRACE_IDS.openAiDecision}-2000000000000001.json.gz`,
          "llm.archive.sha256":
            "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff",
          "llm.archive.bytes_compressed": 910,
          "llm.archive.bytes_uncompressed": 2640,
          "llm.archive.status": "ok",
        },
        events: [],
      },
    ],
  };
}

export function buildLiveFixtureTraces(nowMs: number): OtlpTrace[] {
  return [
    buildAiSdkChatTrace(nowMs - 14 * MINUTE_MS),
    buildDecisionTrace(nowMs - 38 * MINUTE_MS),
    ...buildClaudeCodexAndErrorTraces(
      nowMs - 95 * MINUTE_MS,
      nowMs - 3 * 60 * MINUTE_MS,
      nowMs - 5 * 60 * MINUTE_MS,
    ),
  ];
}
