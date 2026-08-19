import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { ExploreAgentParams } from "#src/explore/agent.ts";
import {
  getExploreQuotaStatus,
  resetExploreRateLimitStateForTests,
  tryStartExploreTurn,
} from "#src/explore/rate-limit.ts";
import { runPersistedExploreTurn } from "#src/explore/run-turn.ts";
import { loadExploreTranscript, startExploreTurn } from "#src/explore/store.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId } from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("explore-run-turn-test");
const userId = testAccountId("73");

const successfulAgent = async (params: ExploreAgentParams) => {
  await params.emit({
    type: "tool_call",
    toolCallId: "call-1",
    toolName: "run_report_query",
    message: "Running query.",
    details: null,
    rawInput: null,
  });
  await params.emit({
    type: "tool_result",
    toolCallId: "call-1",
    toolName: "run_report_query",
    status: "succeeded",
    message: "Got results.",
    durationMs: 7,
    details: null,
    rawOutput: null,
  });
  return {
    answer: {
      answer: "Ahri wins most often.",
      title: "Most frequent winners",
      queryText: "SELECT champion, wins FROM match_participants",
      caveats: ["Tracked matches only."],
      followUps: [],
    },
    preview: null,
    visualization: null,
  };
};

const failingAgent = async (params: ExploreAgentParams) => {
  await params.emit({ type: "answer_delta", text: "Partial evidence." });
  throw new Error("provider failed");
};

beforeEach(async () => {
  resetExploreRateLimitStateForTests();
  await prisma.exploreMessage.deleteMany();
  await prisma.exploreConversation.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.create({
    data: { discordId: userId, discordUsername: "runner" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function preparedTurn() {
  const startedBase = await startExploreTurn(prisma, {
    conversationId: null,
    userId,
    question: "Who wins most often?",
    attach: { kind: "leaf" },
  });
  const started = { ...startedBase, question: "Who wins most often?" };
  const transcript = await loadExploreTranscript(
    prisma,
    started.conversationId,
    userId,
    started.messageId,
  );
  if (transcript === null) {
    throw new Error("Expected prepared transcript.");
  }
  const ticket = tryStartExploreTurn({ userId }, Date.now());
  if (!ticket.allowed) {
    throw new Error("Expected a rate-limit ticket.");
  }
  return { started, history: transcript.messages, ticket };
}

describe("shared persisted Explore turn", () => {
  test("persists a successful answer, title, trace, and charged quota", async () => {
    const prepared = await preparedTurn();

    const terminal = await runPersistedExploreTurn(
      {
        ...prepared,
        identity: { userId },
        emit: () => Promise.resolve(),
      },
      {
        client: prisma,
        executeAgent: successfulAgent,
        now: Date.now,
        timeoutMs: 10_000,
      },
    );

    expect(terminal.type).toBe("final");
    const transcript = await loadExploreTranscript(
      prisma,
      prepared.started.conversationId,
      userId,
    );
    expect(transcript?.conversation.title).toBe("Most frequent winners");
    expect(transcript?.messages[1]?.content).toBe("Ahri wins most often.");
    expect(transcript?.messages[1]?.trace).toEqual([
      {
        toolCallId: "call-1",
        toolName: "run_report_query",
        message: "Got results.",
        status: "succeeded",
        durationMs: 7,
        details: null,
        rawInput: null,
        rawOutput: null,
      },
    ]);
    expect(getExploreQuotaStatus({ userId }).activeRun).toBe(false);
    expect(getExploreQuotaStatus({ userId }).quota[0]?.used).toBe(1);
  });

  test("salvages streamed prose after an agent failure and releases the slot", async () => {
    const prepared = await preparedTurn();

    const terminal = await runPersistedExploreTurn(
      {
        ...prepared,
        identity: { userId },
        emit: () => Promise.resolve(),
      },
      {
        client: prisma,
        executeAgent: failingAgent,
        now: Date.now,
        timeoutMs: 10_000,
      },
    );

    expect(terminal.type).toBe("final");
    if (terminal.type === "final") {
      expect(terminal.message.content).toBe("Partial evidence.");
      expect(terminal.message.caveats).toContain(
        "This answer was interrupted by an error before it finished.",
      );
    }
    expect(getExploreQuotaStatus({ userId }).activeRun).toBe(false);
  });
});
