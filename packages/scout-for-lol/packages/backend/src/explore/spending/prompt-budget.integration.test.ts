import { afterAll, expect, test, vi } from "vitest";
import { asSchema, type ToolSet } from "ai";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  ExploreAnswerWireSchema,
  EXPLORE_MAX_OUTPUT_TOKENS,
} from "@scout-for-lol/data";
import { createExploreTools, type RunState } from "#src/explore/agent-tools.ts";
import type { ExploreAgentParams } from "#src/explore/analysis/agent-types.ts";
import { createAnalysisTools } from "#src/explore/analysis/tools.ts";
import { exploreAgentInstructions } from "#src/explore/prompt.ts";
import type { ExploreSkillOptions } from "#src/explore/skills/registry.ts";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import {
  exploreProviderInputBound,
  EXPLORE_MAX_PROVIDER_INPUT_BOUND,
} from "./input-bound.ts";
import { reserveExploreCall } from "./ledger.ts";

const db = createTestDatabase("explore-prompt-budget");
afterAll(async () => {
  await dropTestDatabase(db.prisma, db.dbPath);
});

async function fullPromptBound() {
  const ownerId = DiscordAccountIdSchema.parse("900000000000009002");
  const serverId = DiscordGuildIdSchema.parse("900000000000009003");
  const clock = { currentTime: "2026-10-03T00:00:00Z" };
  const skillOptions: ExploreSkillOptions = {
    analysis: true,
    bucks: clock,
    mvpVotes: clock,
    dares: true,
    challenges: true,
    creation: true,
    riotHistory: true,
    clash: true,
    hallOfFame: true,
    surface: "web",
  };
  const params: ExploreAgentParams = {
    runId: "prompt-budget",
    conversationId: "prompt-budget",
    requesterId: ownerId,
    question: "What was my build path?",
    history: [],
    guildIds: [serverId],
    originChannelId: null,
    subject: { kind: "discord_user", id: ownerId },
    surface: "web",
    abortSignal: new AbortController().signal,
    emit: vi.fn<ExploreAgentParams["emit"]>(),
  };
  const state: RunState = {
    authorizedProfileUrls: new Set(),
    toolCalls: 0,
    previewCalls: 0,
    lastPreview: null,
    lastVisualization: null,
    lastMatchIds: new Set(),
    lastQueryMatchIds: new Set(),
    lastQueryLoadoutPairs: new Set(),
    loadedSkills: new Set(),
  };
  const tools: ToolSet = {
    ...createExploreTools({
      params,
      state,
      skillOptions,
      bucksCapability: { serverId },
      mvpVotesCapability: { serverId },
      daresEnabled: true,
      challengesEnabled: true,
      creationCapability: { guildIds: [serverId] },
      riotHistoryEnabled: true,
      clashEnabled: true,
      hallCapability: { guildIds: [serverId] },
    }),
    // Include analysis even when this test process has its rollout flag off.
    ...createAnalysisTools(params, async (_name, execute) => await execute()),
  };
  const wireTools = await Promise.all(
    Object.entries(tools).map(async ([name, entry]) => ({
      type: "function",
      name,
      description: entry.description,
      inputSchema: await asSchema(entry.inputSchema).jsonSchema,
    })),
  );
  expect(wireTools.length).toBeGreaterThan(40);
  const inputBound = exploreProviderInputBound({
    prompt: [
      { role: "system", content: exploreAgentInstructions(skillOptions) },
      {
        role: "user",
        content: [{ type: "text", text: params.question }],
      },
    ],
    tools: wireTools,
    responseFormat: {
      type: "json",
      schema: await asSchema(ExploreAnswerWireSchema).jsonSchema,
    },
  });
  return { ownerId, inputBound };
}

test.each(["gpt-6-luna", "gpt-6.1-sol"])(
  "%s admits the real prompt with every capability and analysis enabled",
  async (model) => {
    const { ownerId, inputBound } = await fullPromptBound();
    expect(inputBound).toBeLessThan(EXPLORE_MAX_PROVIDER_INPUT_BOUND);
    const reservation = await reserveExploreCall(
      {
        ownerId,
        runId: `prompt-budget-${model}`,
        model,
        inputBound,
        maxOutputTokens: EXPLORE_MAX_OUTPUT_TOKENS,
      },
      db.prisma,
    );
    expect(reservation.maxOutputTokens).toBe(EXPLORE_MAX_OUTPUT_TOKENS);
    expect(reservation.amount).toBeLessThanOrEqual(500_000);
  },
);
