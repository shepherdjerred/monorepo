import { describe, expect, test } from "bun:test";

import SYSTEM_PROMPT from "#src/review/prompts/system/2-review-text.txt";
import USER_PROMPT from "#src/review/prompts/user/2-review-text.txt";
import FRIEND_GROUP_HISTORY from "#src/review/prompts/context/glitter-boys-history.txt";
import RELATIONSHIP_GRAPH from "#src/review/prompts/context/relationships.txt";

import { generateReviewTextStage } from "#src/review/pipeline-stages.ts";
import type { OpenAIClient, ModelConfig } from "#src/review/pipeline-types.ts";
import type { Personality } from "#src/review/prompts.ts";
import { type CompletedMatch, CompletedMatchSchema } from "#src/model/match.ts";
import { LeaguePuuidSchema } from "#src/model/league-account.ts";

const REVIEWER_NAME = "TestReviewer";
const PLAYER_NAME = "TestPlayer";

const UNIQUE_INSTRUCTIONS_MARKER =
  "FINGERPRINT-INSTRUCTIONS-3f4a09c8: speak only in haiku";
const UNIQUE_STYLE_AUTHOR_MARKER = "FINGERPRINT-STYLE-AUTHOR-9b2c1e74";

function buildPersonalityFixture(): Personality {
  const styleCard = JSON.stringify({
    author: UNIQUE_STYLE_AUTHOR_MARKER,
    voice: ["terse"],
    style_markers: ["lowercase"],
    personality: ["dry"],
    humor_or_tone: ["dry"],
    how_to_mimic: ["short sentences"],
    sample_messages: ["yep"],
    summary: "test fixture",
  });

  return {
    metadata: {
      name: REVIEWER_NAME,
      randomBehaviors: [{ prompt: "say hi", weight: 100 }],
      image: ["a test image prompt"],
    },
    instructions: UNIQUE_INSTRUCTIONS_MARKER,
    styleCard,
    filename: "test-reviewer",
  };
}

function buildMatchFixture(): CompletedMatch {
  const puuid = LeaguePuuidSchema.parse("a".repeat(78));
  const fakeChampion = {
    riotIdGameName: "Ally",
    championName: "Lux",
    kills: 5,
    deaths: 3,
    assists: 7,
    level: 14,
    items: [],
    spells: [],
    gold: 12_000,
    runes: [],
    creepScore: 180,
    visionScore: 22,
    damage: 18_000,
  } as const;

  const roster = [
    fakeChampion,
    fakeChampion,
    fakeChampion,
    fakeChampion,
    fakeChampion,
  ];

  return CompletedMatchSchema.parse({
    durationInSeconds: 1800,
    queueType: "solo",
    players: [
      {
        playerConfig: {
          alias: PLAYER_NAME,
          league: {
            leagueAccount: {
              puuid,
              region: "AMERICA_NORTH",
            },
          },
        },
        outcome: "Victory",
        champion: {
          ...fakeChampion,
          championName: "Ahri",
          riotIdGameName: PLAYER_NAME,
        },
        team: "blue",
        lane: "middle",
        laneOpponent: { ...fakeChampion, championName: "Zed" },
      },
    ],
    teams: { red: roster, blue: roster },
  });
}

type RecordedCall = {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
};

function buildRecordingClient(): {
  client: OpenAIClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const client: OpenAIClient = {
    chat: {
      completions: {
        create: async (params) => {
          calls.push({ model: params.model, messages: params.messages });
          await Promise.resolve();
          return {
            choices: [
              {
                message: { content: "stub review text" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          };
        },
      },
    },
  };
  return { client, calls };
}

describe("generateReviewTextStage — Stage 2 system prompt injection", () => {
  const model: ModelConfig = {
    model: "gpt-test",
    maxTokens: 1024,
    temperature: 1,
    topP: 1,
  };

  test("rendered system prompt contains personality + glitter timeline + relationship graph", async () => {
    const { client, calls } = buildRecordingClient();
    const personality = buildPersonalityFixture();
    const match = buildMatchFixture();

    const result = await generateReviewTextStage({
      match,
      personality,
      laneContext: "middle lane is for mages and assassins",
      playerIndex: 0,
      matchSummary: "FINGERPRINT-MATCH-SUMMARY",
      timelineSummary: "FINGERPRINT-TIMELINE-SUMMARY",
      client,
      model,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: USER_PROMPT,
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call === undefined) throw new Error("missing recorded call");
    const systemMsg = call.messages.find((m) => m.role === "system");
    if (systemMsg === undefined) throw new Error("no system message captured");
    const userMsg = call.messages.find((m) => m.role === "user");
    if (userMsg === undefined) throw new Error("no user message captured");

    expect(systemMsg.content).toContain(UNIQUE_INSTRUCTIONS_MARKER);
    expect(systemMsg.content).toContain(UNIQUE_STYLE_AUTHOR_MARKER);

    const historyMarker = FRIEND_GROUP_HISTORY.trim().split("\n")[0];
    if (historyMarker === undefined || historyMarker.length === 0) {
      throw new Error("glitter-boys-history.txt unexpectedly empty");
    }
    expect(systemMsg.content).toContain(historyMarker);
    expect(systemMsg.content).toContain("Glitter Boys");

    expect(systemMsg.content).toContain("digraph");
    const graphSnippet = RELATIONSHIP_GRAPH.trim().slice(0, 80);
    expect(systemMsg.content).toContain(graphSnippet);

    expect(systemMsg.content).toContain(REVIEWER_NAME);
    expect(systemMsg.content).toContain(PLAYER_NAME);

    expect(userMsg.content).toContain(PLAYER_NAME);
    expect(userMsg.content).toContain("Ahri");
    expect(userMsg.content).toContain("middle");
    expect(userMsg.content).toContain("Zed");
    expect(userMsg.content).toContain("FINGERPRINT-MATCH-SUMMARY");

    expect(result.text).toBe("stub review text");
    expect(result.reviewerName).toBe(REVIEWER_NAME);
    expect(result.playerName).toBe(PLAYER_NAME);
    expect(result.trace.request.systemPrompt).toBe(systemMsg.content);
  });

  test("system prompt is identical between the LLM call and the captured trace", async () => {
    const { client, calls } = buildRecordingClient();
    const personality = buildPersonalityFixture();
    const match = buildMatchFixture();

    const result = await generateReviewTextStage({
      match,
      personality,
      laneContext: "test lane",
      playerIndex: 0,
      matchSummary: "summary",
      client,
      model,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: USER_PROMPT,
    });

    const call = calls[0];
    if (call === undefined) throw new Error("missing recorded call");
    const systemMsg = call.messages.find((m) => m.role === "system");
    if (systemMsg === undefined) throw new Error("no system message captured");

    expect(result.trace.request.systemPrompt).toBe(systemMsg.content);
  });
});
