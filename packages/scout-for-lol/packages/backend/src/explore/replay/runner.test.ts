import { describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  ExploreAnswerSchema,
  ExploreMessageSchema,
  ExploreStreamEventSchema,
  type ExploreMessage,
} from "@scout-for-lol/data";
// `ExploreAgentParams` is declared in agent-tools and only imported by
// agent.ts, which does not re-export it.
import type { ExploreAgentParams } from "#src/explore/agent-tools.ts";
import type { ExploreAgentResult } from "#src/explore/agent.ts";
import {
  runReplayCase,
  runReplayCases,
  type ReplayCaseInput,
  type ReplayRunnerDependencies,
} from "./runner.ts";
import type { ExploreCapabilitySet } from "./profiles.ts";

/**
 * A stand-in for the agent, typed rather than asserted.
 *
 * `streamExploreAgent`'s signature is exactly this, so a stub written to it is
 * assignable with no cast — which is what keeps these tests honest about the
 * shape the real agent is actually called with.
 */
type AgentStub = (params: ExploreAgentParams) => Promise<ExploreAgentResult>;

const REQUESTER = DiscordAccountIdSchema.parse("100000000000000001");

const ANSWER = ExploreAnswerSchema.parse({
  answer: "Ezreal, at 54%.",
  caveats: [],
  followUps: [],
  includeVisualization: false,
  matchCards: [],
});

const RESULT: ExploreAgentResult = {
  answer: ANSWER,
  preview: null,
  visualization: null,
  matchCards: [],
};

const CAPABILITIES: ExploreCapabilitySet = {
  bucks: false,
  dares: false,
  challenges: false,
  creation: false,
  riotHistory: false,
  mvpVotes: false,
  clash: false,
};

function message(input: {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
}): ExploreMessage {
  return ExploreMessageSchema.parse({
    id: input.id,
    role: input.role,
    content: input.content,
    createdAt: "2026-09-01T00:00:00.000Z",
  });
}

const PRIOR_QUESTION = message({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  role: "user",
  content: "Who wins most?",
});
const PRIOR_ANSWER = message({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "assistant",
  content: "Ezreal.",
});

function caseInput(overrides: Partial<ReplayCaseInput> = {}): ReplayCaseInput {
  return {
    caseId: overrides.caseId ?? "chip:abc",
    kind: overrides.kind ?? "chip",
    conversationId:
      overrides.conversationId ?? "11111111-1111-4111-8111-111111111111",
    question: overrides.question ?? "Which champion wins most?",
    history: overrides.history ?? [],
    requesterId: overrides.requesterId ?? REQUESTER,
    guildIds: overrides.guildIds ?? ["222222222222222222"],
    surface: overrides.surface ?? "web",
    originChannelId: overrides.originChannelId ?? null,
  };
}

const OK_STUB: AgentStub = async () => RESULT;

const TRACING_STUB: AgentStub = async (params) => {
  await params.emit(
    ExploreStreamEventSchema.parse({
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "run_report_query",
      message: "Running a query.",
      details: null,
      rawInput: null,
    }),
  );
  await params.emit(
    ExploreStreamEventSchema.parse({
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "run_report_query",
      message: "Returned 3 rows.",
      status: "succeeded",
      durationMs: 12,
      details: null,
      rawOutput: null,
    }),
  );
  return RESULT;
};

const THROWING_STUB: AgentStub = async () => {
  await Promise.resolve();
  throw new Error("provider exploded");
};

const SLOW_STUB: AgentStub = async (params) => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  throw new Error(params.abortSignal.aborted ? "aborted" : "not reached");
};

const FAILS_AFTER_ONE_TOOL_STUB: AgentStub = async (params) => {
  await params.emit(
    ExploreStreamEventSchema.parse({
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "load_skill",
      message: "Loading scoutql.",
      details: null,
      rawInput: null,
    }),
  );
  throw new Error("died after one tool call");
};

function dependencies(
  overrides: Partial<ReplayRunnerDependencies> = {},
): ReplayRunnerDependencies {
  let clock = 0;
  return {
    executeAgent: overrides.executeAgent ?? OK_STUB,
    resolveCapabilities:
      overrides.resolveCapabilities ?? (async () => CAPABILITIES),
    now:
      overrides.now ??
      (() => {
        clock += 5;
        return clock;
      }),
    timeoutMs: overrides.timeoutMs ?? 30_000,
    newRunId: overrides.newRunId ?? (() => "run-1"),
  };
}

describe("runReplayCase", () => {
  test("returns the agent's answer and the resolved capabilities", async () => {
    const observation = await runReplayCase(caseInput(), dependencies());
    expect(observation.status).toBe("ok");
    expect(observation.answer?.answer).toBe("Ezreal, at 54%.");
    expect(observation.capabilities).toEqual(CAPABILITIES);
    expect(observation.error).toBeNull();
  });

  test("passes the pinned history through as the agent's history", async () => {
    const history = [PRIOR_QUESTION, PRIOR_ANSWER];
    let seen: readonly ExploreMessage[] = [];
    const stub: AgentStub = async (params) => {
      seen = params.history;
      return RESULT;
    };
    const observation = await runReplayCase(
      caseInput({ history, kind: "conversation" }),
      dependencies({ executeAgent: stub }),
    );
    expect(observation.status).toBe("ok");
    expect(seen).toEqual(history);
  });

  test("records the model messages, including the replayed history", async () => {
    const observation = await runReplayCase(
      caseInput({
        history: [PRIOR_QUESTION, PRIOR_ANSWER],
        question: "And on ARAM?",
      }),
      dependencies(),
    );
    expect(observation.modelMessages).toHaveLength(3);
    expect(observation.modelMessages.at(-1)).toEqual({
      role: "user",
      content: "And on ARAM?",
    });
  });

  test("folds tool stream events into a trace", async () => {
    const observation = await runReplayCase(
      caseInput(),
      dependencies({ executeAgent: TRACING_STUB }),
    );
    expect(observation.trace).toHaveLength(1);
    expect(observation.trace[0]?.toolName).toBe("run_report_query");
    expect(observation.trace[0]?.status).toBe("succeeded");
  });

  test("reports a thrown turn as an error, keeping the prompt", async () => {
    const observation = await runReplayCase(
      caseInput(),
      dependencies({ executeAgent: THROWING_STUB }),
    );
    expect(observation.status).toBe("error");
    expect(observation.error).toBe("provider exploded");
    expect(observation.answer).toBeNull();
    // A failed case with no visible prompt is the least useful row in a bundle.
    expect(observation.modelMessages).toHaveLength(1);
  });

  test("distinguishes a timeout from an ordinary failure", async () => {
    const observation = await runReplayCase(
      caseInput(),
      dependencies({ timeoutMs: 1, executeAgent: SLOW_STUB }),
    );
    expect(observation.status).toBe("timeout");
  });

  test("keeps the trace collected before a failure", async () => {
    const observation = await runReplayCase(
      caseInput(),
      dependencies({ executeAgent: FAILS_AFTER_ONE_TOOL_STUB }),
    );
    expect(observation.status).toBe("error");
    expect(observation.trace).toHaveLength(1);
    // Finalized rather than left "running": the step never got a terminal part,
    // and a bundle read hours later should not imply a tool still in flight.
    expect(observation.trace[0]?.status).toBe("interrupted");
  });
});

describe("runReplayCases", () => {
  test("preserves input order regardless of completion order", async () => {
    // Earlier cases finish last, so completion order is not input order.
    const delays = new Map([
      ["chip:a", 24],
      ["chip:b", 16],
      ["chip:c", 8],
      ["chip:d", 1],
    ]);
    const cases = ["a", "b", "c", "d"].map((id) =>
      caseInput({ caseId: `chip:${id}`, question: `chip:${id}` }),
    );
    const stub: AgentStub = async (params) => {
      await new Promise((resolve) =>
        setTimeout(resolve, delays.get(params.question) ?? 1),
      );
      return RESULT;
    };
    const observations = await runReplayCases(
      cases,
      dependencies({ executeAgent: stub }),
      { concurrency: 4 },
    );
    expect(observations.map((entry) => entry.caseId)).toEqual([
      "chip:a",
      "chip:b",
      "chip:c",
      "chip:d",
    ]);
  });

  test("runs every case exactly once", async () => {
    const seen: string[] = [];
    const cases = ["a", "b", "c"].map((id) =>
      caseInput({ caseId: `chip:${id}` }),
    );
    await runReplayCases(cases, dependencies(), {
      concurrency: 2,
      onComplete: async (observation) => {
        seen.push(observation.caseId);
        await Promise.resolve();
      },
    });
    expect(seen.toSorted()).toEqual(["chip:a", "chip:b", "chip:c"]);
  });

  test("handles an empty corpus without hanging", async () => {
    expect(
      await runReplayCases([], dependencies(), { concurrency: 4 }),
    ).toEqual([]);
  });
});
