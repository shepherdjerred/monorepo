import { afterAll, beforeEach, describe, expect, test } from "vitest";
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

// A bucks-tools turn runs no ScoutQL, so its answer carries queryText: null
// and nothing downstream may require a preview or a chart.
const bucksOnlyAgent = async (params: ExploreAgentParams) => {
  await params.emit({
    type: "tool_result",
    toolCallId: "call-bb",
    toolName: "query_bucks_bets",
    status: "succeeded",
    message: "Got Bryan Bucks results.",
    durationMs: 3,
    details: null,
    rawOutput: null,
  });
  return {
    answer: {
      answer: "You are up 12 BB this month.",
      title: "Monthly Bryan Bucks net",
      queryText: null,
      caveats: [],
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
        guildIds: [],
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
    expect(terminal.outcome).toBe("succeeded");
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

  test("persists a Bryan-Bucks-only answer with no ScoutQL, preview, or visualization", async () => {
    const prepared = await preparedTurn();

    const terminal = await runPersistedExploreTurn(
      {
        ...prepared,
        identity: { userId },
        guildIds: [],
        emit: () => Promise.resolve(),
      },
      {
        client: prisma,
        executeAgent: bucksOnlyAgent,
        now: Date.now,
        timeoutMs: 10_000,
      },
    );

    expect(terminal.type).toBe("final");
    expect(terminal.outcome).toBe("succeeded");
    const transcript = await loadExploreTranscript(
      prisma,
      prepared.started.conversationId,
      userId,
    );
    expect(transcript?.messages[1]?.content).toBe(
      "You are up 12 BB this month.",
    );
    expect(transcript?.messages[1]?.queryText).toBeNull();
    expect(transcript?.messages[1]?.preview).toBeNull();
    expect(transcript?.messages[1]?.visualization).toBeNull();
  });

  test("salvages streamed prose after an agent failure and releases the slot", async () => {
    const prepared = await preparedTurn();

    const terminal = await runPersistedExploreTurn(
      {
        ...prepared,
        identity: { userId },
        guildIds: [],
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
    expect(terminal.outcome).toBe("failed");
    if (terminal.type === "final") {
      expect(terminal.message.content).toBe("Partial evidence.");
      expect(terminal.message.caveats).toContain(
        "This answer was interrupted by an error before it finished.",
      );
    }
    expect(getExploreQuotaStatus({ userId }).activeRun).toBe(false);
  });

  test("a zero-prose cancellation rolls back its generated title", async () => {
    const prepared = await preparedTurn();
    const caller = new AbortController();
    const cancelAfterTitle = prisma.$extends({
      query: {
        exploreConversation: {
          async updateMany({ args, query }) {
            const result = await query(args);
            if (result.count > 0 && !caller.signal.aborted) {
              caller.abort("Stopped while applying the generated title.");
            }
            return result;
          },
        },
      },
    });

    const terminal = await runPersistedExploreTurn(
      {
        ...prepared,
        identity: { userId },
        guildIds: [],
        abortSignal: caller.signal,
        abortOutcome: () => "stopped",
        emit: () => Promise.resolve(),
      },
      {
        client: cancelAfterTitle,
        executeAgent: successfulAgent,
        now: Date.now,
        timeoutMs: 10_000,
      },
    );

    expect(terminal.type).toBe("error");
    expect(terminal.outcome).toBe("stopped");
    const transcript = await loadExploreTranscript(
      prisma,
      prepared.started.conversationId,
      userId,
    );
    expect(transcript?.conversation.title).toBe("Who wins most often?");
    expect(transcript?.messages).toHaveLength(1);
    expect(transcript?.messages[0]?.role).toBe("user");
  });

  test("the first cancellation source determines the outcome", async () => {
    const prepared = await preparedTurn();
    const caller = new AbortController();
    const timeoutAgent = async (params: ExploreAgentParams) =>
      await new Promise<never>((_resolve, reject) => {
        params.abortSignal.addEventListener(
          "abort",
          () => {
            caller.abort("Stop arrived after the timeout.");
            reject(new Error("timed out"));
          },
          { once: true },
        );
      });

    const terminal = await runPersistedExploreTurn(
      {
        ...prepared,
        identity: { userId },
        guildIds: [],
        abortSignal: caller.signal,
        abortOutcome: () => "stopped",
        emit: () => Promise.resolve(),
      },
      {
        client: prisma,
        executeAgent: timeoutAgent,
        now: Date.now,
        timeoutMs: 5,
      },
    );

    expect(terminal.type).toBe("error");
    expect(terminal.outcome).toBe("interrupted");
  });
});
