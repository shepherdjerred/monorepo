import type { ArchivedSpanIndexRow } from "@shepherdjerred/ops-model/llm-traces.ts";

export const FIXTURE_TRACE_IDS = {
  aiSdkChat: "a1f4c8e29b304d178e65c20194ab7701",
  openAiDecision: "b2e5d9f30c415e289f76d31205bc8802",
  claudeAgent: "c3f6e0a41d526f390a87e42316cd9903",
  codexAgent: "d4a7f1b52e637a401b98f53427de0004",
  erroredBirmel: "e5b8a2c63f748b512c09a64538ef1105",
  archiveOnlyDigest: "f6c9b3d74a859c623d10b75649fa2206",
} as const;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export function buildArchivedIndexSeed(nowMs: number): {
  rows: ArchivedSpanIndexRow[];
  envelopes: ReadonlyMap<string, Record<string, unknown>>;
} {
  const archive65dMs = nowMs - 65 * DAY_MS;
  const archiveEmbedKey = `llm/scout-backend/openai/2026/09/20/${FIXTURE_TRACE_IDS.archiveOnlyDigest}-6000000000000001.json.gz`;
  const archiveChatKey = `llm/scout-backend/openai/2026/09/20/${FIXTURE_TRACE_IDS.archiveOnlyDigest}-6000000000000002.json.gz`;

  const rows: ArchivedSpanIndexRow[] = [
    {
      s3Key: `llm/scout-backend/openai/2026/11/24/${FIXTURE_TRACE_IDS.aiSdkChat}-1000000000000003.json.gz`,
      traceId: FIXTURE_TRACE_IDS.aiSdkChat,
      spanId: "1000000000000003",
      capturedAtMs: nowMs - 14 * MINUTE_MS,
      service: "scout-backend",
      provider: "openai",
      callSite: "match-review",
      requestModel: "gpt-6.1-sol",
      responseModel: "gpt-6.1-sol",
      responseId: "resp_chat_step1",
      finishReason: "tool-calls",
      inputTokens: 1420,
      outputTokens: 96,
      cacheReadTokens: 1024,
      cacheCreationTokens: 0,
      hasToolIo: true,
      bytesCompressed: 1284,
      bytesUncompressed: 4120,
    },
    {
      s3Key: `llm/scout-backend/openai/2026/11/24/${FIXTURE_TRACE_IDS.aiSdkChat}-1000000000000006.json.gz`,
      traceId: FIXTURE_TRACE_IDS.aiSdkChat,
      spanId: "1000000000000006",
      capturedAtMs: nowMs - 14 * MINUTE_MS + 2955,
      service: "scout-backend",
      provider: "openai",
      callSite: "match-review",
      requestModel: "gpt-6.1-sol",
      responseModel: "gpt-6.1-sol",
      responseId: "resp_chat_repair3",
      finishReason: "stop",
      inputTokens: 4990,
      outputTokens: 395,
      cacheReadTokens: 3456,
      cacheCreationTokens: 0,
      hasToolIo: true,
      bytesCompressed: 1540,
      bytesUncompressed: 4890,
    },
    {
      s3Key: `llm/scout-backend/openai/2026/11/24/${FIXTURE_TRACE_IDS.openAiDecision}-2000000000000001.json.gz`,
      traceId: FIXTURE_TRACE_IDS.openAiDecision,
      spanId: "2000000000000001",
      capturedAtMs: nowMs - 38 * MINUTE_MS,
      service: "scout-backend",
      provider: "openai",
      callSite: "dare-eligibility",
      requestModel: "gpt-6-luna",
      responseModel: "gpt-6-luna",
      responseId: "dec_01J9DARE",
      finishReason: "stop",
      inputTokens: 920,
      outputTokens: 48,
      cacheReadTokens: 512,
      cacheCreationTokens: 0,
      hasToolIo: false,
      bytesCompressed: 910,
      bytesUncompressed: 2640,
    },
    {
      s3Key: `llm/temporal-agent-worker/claude_code_sdk/2026/11/24/${FIXTURE_TRACE_IDS.claudeAgent}-3000000000000001.json.gz`,
      traceId: FIXTURE_TRACE_IDS.claudeAgent,
      spanId: "3000000000000001",
      capturedAtMs: nowMs - 95 * MINUTE_MS,
      service: "temporal-agent-worker",
      provider: "claude_code_sdk",
      callSite: "pr-remediation",
      requestModel: "claude-sonnet-5-5",
      responseModel: "claude-sonnet-5-5",
      responseId: "sess_claude_01J9PR5041",
      finishReason: "end_turn",
      inputTokens: 8420,
      outputTokens: 1120,
      cacheReadTokens: 6100,
      cacheCreationTokens: 940,
      hasToolIo: true,
      bytesCompressed: 2190,
      bytesUncompressed: 7430,
    },
    {
      s3Key: `llm/discord-plays-pokemon/codex_sdk/2026/11/24/${FIXTURE_TRACE_IDS.codexAgent}-4000000000000002.json.gz`,
      traceId: FIXTURE_TRACE_IDS.codexAgent,
      spanId: "4000000000000002",
      capturedAtMs: nowMs - 3 * 60 * MINUTE_MS,
      service: "discord-plays-pokemon",
      provider: "codex_sdk",
      callSite: "pokemon-goal-runner",
      requestModel: "gpt-5.3-codex",
      responseModel: "gpt-5.3-codex",
      responseId: null,
      finishReason: "stop",
      inputTokens: 4030,
      outputTokens: 575,
      cacheReadTokens: 2624,
      cacheCreationTokens: 0,
      hasToolIo: true,
      bytesCompressed: 1120,
      bytesUncompressed: 3480,
    },
    {
      s3Key: `llm/birmel/anthropic/2026/11/24/${FIXTURE_TRACE_IDS.erroredBirmel}-5000000000000001.json.gz`,
      traceId: FIXTURE_TRACE_IDS.erroredBirmel,
      spanId: "5000000000000001",
      capturedAtMs: nowMs - 5 * 60 * MINUTE_MS,
      service: "birmel",
      provider: "anthropic",
      callSite: "discord-reply",
      requestModel: "claude-sonnet-5-5",
      responseModel: null,
      responseId: null,
      finishReason: "error",
      inputTokens: 640,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasToolIo: false,
      bytesCompressed: 410,
      bytesUncompressed: 980,
    },
    {
      s3Key: archiveEmbedKey,
      traceId: FIXTURE_TRACE_IDS.archiveOnlyDigest,
      spanId: "6000000000000001",
      capturedAtMs: archive65dMs,
      service: "scout-backend",
      provider: "openai",
      callSite: "patch-notes-digest",
      requestModel: "text-embedding-3-small",
      responseModel: "text-embedding-3-small",
      responseId: "emb_patch_1618",
      finishReason: "stop",
      inputTokens: 380,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasToolIo: false,
      bytesCompressed: 620,
      bytesUncompressed: 1840,
    },
    {
      s3Key: archiveChatKey,
      traceId: FIXTURE_TRACE_IDS.archiveOnlyDigest,
      spanId: "6000000000000002",
      capturedAtMs: archive65dMs + 1450,
      service: "scout-backend",
      provider: "openai",
      callSite: "patch-notes-digest",
      requestModel: "gpt-6.1-sol",
      responseModel: "gpt-6.1-sol",
      responseId: "resp_patch_1618",
      finishReason: "stop",
      inputTokens: 3140,
      outputTokens: 485,
      cacheReadTokens: 2048,
      cacheCreationTokens: 0,
      hasToolIo: false,
      bytesCompressed: 1890,
      bytesUncompressed: 6120,
    },
  ];

  const envelopes = new Map<string, Record<string, unknown>>([
    [
      archiveEmbedKey,
      {
        "ai.values": [
          "Patch 16.18 mage item AP scaling adjustments",
          "Baron Nashor fortitude buff duration reduced by 15s",
        ],
        "ai.embeddings": [
          [0.018, -0.041, 0.092, 0.037],
          [-0.022, 0.064, 0.015, -0.058],
        ],
      },
    ],
    [
      archiveChatKey,
      {
        "gen_ai.system_instructions":
          "Summarize League of Legends patch notes for tracked ranked players in concise bullet points.",
        "gen_ai.input.messages": [
          {
            role: "user",
            content:
              "Compile the Patch 16.18 digest focusing on control mages and Baron macro pacing.",
          },
        ],
        "gen_ai.output.messages": [
          {
            role: "assistant",
            content:
              "Patch 16.18 shifts mid-lane priority toward Orianna and Azir while rewarding faster 20-minute Baron setups.",
          },
        ],
      },
    ],
  ]);

  return { rows, envelopes };
}
