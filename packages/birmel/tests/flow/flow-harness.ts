import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { z } from "zod";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import {
  RouteDecisionSchema,
  TurnInputSchema,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import type { MessageHandler } from "@shepherdjerred/birmel/discord/events/message-create.ts";
import {
  FLOW_RESULT_PREFIX,
  FlowHarnessResultSchema,
  FlowScenarioSchema,
  type FlowScenario,
  type FlowScenarioResult,
} from "./contracts.ts";
import { createContextBundle } from "./fixtures.ts";
import {
  createFlowMessageContext,
  invokeFlowHandler,
  waitForAgentRunAdmission,
  waitForFirstFlowPlaceholder,
} from "./message-fixture.ts";
import { suppressAutomaticMemoryExtraction } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";

const RuntimeOptionsSchema = z.object({
  turn: TurnInputSchema,
  route: RouteDecisionSchema,
  personaId: z.literal("Compact elected persona"),
  persona: z.literal("PERSONA_SOURCE_SENTINEL"),
});
const RouteOptionsSchema = z.object({
  turn: TurnInputSchema,
  personaId: z.literal("Compact elected persona"),
  persona: z.literal("PERSONA_SOURCE_SENTINEL"),
});
const ContextOptionsSchema = z.object({ turn: TurnInputSchema });
const SessionEventOptionsSchema = z.object({ role: z.string() });
const SessionRevalidationOptionsSchema = z.object({
  sessionId: z.string(),
  guildId: z.string(),
  threadId: z.string(),
});
const AgentRunRowSchema = z.object({
  status: z.string(),
  responseMessageId: z.string().nullable(),
  incidentId: z.string().nullable(),
  errorClass: z.string().nullable(),
  finishReason: z.string().nullable(),
});
const AgentRunRowsSchema = z.array(AgentRunRowSchema);
const ColumnRowsSchema = z.array(z.object({ name: z.string() }));

const scenarios = FlowScenarioSchema.options;

type MutableScenarioState = {
  scenario: FlowScenario;
  replyCalls: number;
  replyPayloads: string[];
  editAttempts: string[];
  deliveredEdits: string[];
  contextCalls: number;
  routerCalls: number;
  directCalls: number;
  specialistCalls: number;
  toolCalls: number;
  memoryExtractionCalls: number;
  sessionEventCalls: number;
  deliveryOrder: string[];
  secondReplyObservedWhileFirstBlocked: boolean;
  sessionActive: boolean;
  concurrentGate: Promise<void>;
  releaseConcurrentGate?: () => void;
};

function createState(scenario: FlowScenario): MutableScenarioState {
  let releaseConcurrentGate: (() => void) | undefined;
  const concurrentGate = new Promise<void>((resolve) => {
    releaseConcurrentGate = resolve;
  });
  return {
    scenario,
    replyCalls: 0,
    replyPayloads: [],
    editAttempts: [],
    deliveredEdits: [],
    contextCalls: 0,
    routerCalls: 0,
    directCalls: 0,
    specialistCalls: 0,
    toolCalls: 0,
    memoryExtractionCalls: 0,
    sessionEventCalls: 0,
    deliveryOrder: [],
    secondReplyObservedWhileFirstBlocked: false,
    sessionActive: true,
    concurrentGate,
    ...(releaseConcurrentGate == null ? {} : { releaseConcurrentGate }),
  };
}

let state = createState("direct");

const fakeSpan = {
  setAttribute(_name: string, _value: unknown): void {
    // Content-free span attributes are irrelevant to deterministic flow tests.
  },
};

void mock.module("@shepherdjerred/birmel/context/turn-context.ts", () => ({
  buildContextForTurn: async (rawOptions: unknown) => {
    const options = ContextOptionsSchema.parse(rawOptions);
    state.contextCalls += 1;
    if (state.scenario === "context-failure") {
      throw new Error("CONTEXT_SECRET_EXCEPTION");
    }
    if (
      (state.scenario === "concurrent-ordering" ||
        state.scenario === "queued-session-inactive") &&
      options.turn.content.startsWith("first ")
    ) {
      await state.concurrentGate;
    }
    return createContextBundle();
  },
}));

void mock.module("@shepherdjerred/birmel/agent-runtime/router.ts", () => ({
  routeTurn: (rawOptions: unknown) => {
    RouteOptionsSchema.parse(rawOptions);
    state.routerCalls += 1;
    if (state.scenario === "router-malformed") {
      return RouteDecisionSchema.parse({
        route: "direct",
        secondRoute: "server",
        confidence: 1,
        rationale: "Ambiguous output",
      });
    }
    const specialist =
      state.scenario === "specialist-tool" ||
      state.scenario === "specialist-failure" ||
      state.scenario === "tool-output-failure";
    return RouteDecisionSchema.parse({
      route: specialist ? "messaging" : "direct",
      confidence: 1,
      rationale: specialist ? "Requires one messaging tool" : "Direct chat",
    });
  },
}));

void mock.module("@shepherdjerred/birmel/agent-runtime/runtime.ts", () => ({
  executeRoutedTurn: (rawOptions: unknown) => {
    const options = RuntimeOptionsSchema.parse(rawOptions);
    if (options.route.route === "direct") {
      state.directCalls += 1;
      if (state.scenario === "memory-deletion") {
        suppressAutomaticMemoryExtraction();
      }
      return {
        text: `direct reply for ${options.turn.discordMessageId}`,
        finishReason: "stop",
        inputTokens: 12,
        outputTokens: 6,
        stepCount: 1,
        toolEvents: [],
      };
    }

    state.specialistCalls += 1;
    if (state.scenario === "specialist-failure") {
      throw new Error("SPECIALIST_SECRET_EXCEPTION");
    }
    state.toolCalls += 1;
    const ToolResultSchema = z.strictObject({
      success: z.literal(true),
      messageId: z.string(),
    });
    if (state.scenario === "tool-output-failure") {
      try {
        ToolResultSchema.parse({
          success: true,
          wrongField: "TOOL_OUTPUT_SECRET_EXCEPTION",
        });
      } catch {
        throw new Error("TOOL_OUTPUT_SECRET_EXCEPTION");
      }
    }
    ToolResultSchema.parse({ success: true, messageId: "tool-message-1" });
    return {
      text: `specialist reply for ${options.turn.discordMessageId}`,
      finishReason: "tool-calls",
      inputTokens: 20,
      outputTokens: 8,
      stepCount: 2,
      toolEvents: [
        { toolId: "manage-message", content: "Tool manage-message completed" },
      ],
    };
  },
}));

void mock.module(
  "@shepherdjerred/birmel/agent-runtime/memory-extraction.ts",
  () => ({
    extractAndApplyTurnMemory: () => {
      state.memoryExtractionCalls += 1;
      return Promise.resolve();
    },
  }),
);

void mock.module("@shepherdjerred/birmel/persona/guild-persona.ts", () => ({
  getGuildPersona: () => Promise.resolve("Compact elected persona"),
}));

void mock.module(
  "@shepherdjerred/birmel/discord/utils/channel-history.ts",
  () => ({
    getConversationTranscriptResult: () =>
      Promise.resolve({
        messages: [],
        fetchFailed: false,
      }),
  }),
);

void mock.module(
  "@shepherdjerred/birmel/discord/engagement-tracker.ts",
  () => ({ markEngaged: () => null }),
);

void mock.module("@shepherdjerred/birmel/config/index.ts", () => ({
  getConfig: () => ({
    responder: { transcriptWindowMs: 3_600_000, transcriptMaxMessages: 50 },
  }),
}));

void mock.module("@shepherdjerred/birmel/sessions/service.ts", () => ({
  appendSessionEvent: (rawOptions: unknown) => {
    const options = SessionEventOptionsSchema.parse(rawOptions);
    state.sessionEventCalls += 1;
    if (
      state.scenario === "session-persistence-failure" &&
      options.role === "assistant"
    ) {
      return Promise.reject(new Error("SESSION_PERSISTENCE_SECRET_EXCEPTION"));
    }
    return Promise.resolve();
  },
  isSessionActiveForThread: (rawOptions: unknown) => {
    const options = SessionRevalidationOptionsSchema.parse(rawOptions);
    if (options.guildId !== "22222222222222222") {
      throw new Error("Queued session revalidation used the wrong guild");
    }
    if (options.threadId !== "33333333333333333") {
      throw new Error("Queued session revalidation used the wrong thread");
    }
    const expectedSessionId =
      state.scenario === "queued-session-inactive"
        ? "queued-session"
        : "session-persistence-failure";
    if (options.sessionId !== expectedSessionId) {
      throw new Error("Queued session revalidation used the wrong session");
    }
    return Promise.resolve(state.sessionActive);
  },
}));

void mock.module("@shepherdjerred/birmel/sessions/summarization.ts", () => ({
  summarizeSessionIfNeeded: () => Promise.resolve(),
}));

void mock.module("@shepherdjerred/birmel/observability/sentry.ts", () => ({
  captureException: () => null,
  clearSentryContext: () => null,
  setSentryContext: () => null,
}));

void mock.module("@shepherdjerred/birmel/observability/tracing.ts", () => ({
  withSpan: async (
    _name: string,
    _attributes: Readonly<Record<string, unknown>>,
    operation: (span: typeof fakeSpan) => Promise<unknown>,
  ) => await operation(fakeSpan),
}));

void mock.module("@shepherdjerred/birmel/utils/logger.ts", () => ({
  logger: {
    info: (..._values: unknown[]) => null,
    error: (..._values: unknown[]) => null,
  },
}));

function messageContext(
  options: Parameters<typeof createFlowMessageContext>[0],
) {
  return createFlowMessageContext(options, state);
}

async function queryScenarioRuns(prisma: PrismaClient, messageIds: string[]) {
  return AgentRunRowsSchema.parse(
    await prisma.agentRun.findMany({
      where: { discordMessageId: { in: messageIds } },
      orderBy: { discordMessageId: "asc" },
      select: {
        status: true,
        responseMessageId: true,
        incidentId: true,
        errorClass: true,
        finishReason: true,
      },
    }),
  );
}

async function runScenario(options: {
  scenario: FlowScenario;
  index: number;
  handler: MessageHandler;
  prisma: PrismaClient;
  databasePath: string;
}): Promise<FlowScenarioResult> {
  state = createState(options.scenario);
  const base = 10_000_000_000_000_000n + BigInt(options.index * 10);
  const firstId = base.toString();
  const secondId = (base + 1n).toString();
  const messageIds =
    options.scenario === "concurrent-ordering" ||
    options.scenario === "queued-session-inactive"
      ? [firstId, secondId]
      : [firstId];

  if (options.scenario === "dedupe") {
    const context = messageContext({ messageId: firstId });
    await invokeFlowHandler(options.handler, context);
    await invokeFlowHandler(options.handler, context);
  } else if (
    options.scenario === "concurrent-ordering" ||
    options.scenario === "queued-session-inactive"
  ) {
    const queuedSession = options.scenario === "queued-session-inactive";
    const first = invokeFlowHandler(
      options.handler,
      messageContext({
        messageId: firstId,
        content: queuedSession
          ? "first queued session request"
          : "first concurrent request",
      }),
    );
    await waitForFirstFlowPlaceholder(state);
    const second = invokeFlowHandler(
      options.handler,
      messageContext({
        messageId: secondId,
        content: queuedSession
          ? "second queued session request"
          : "second concurrent request",
      }),
    );
    if (queuedSession) {
      await waitForAgentRunAdmission(options.prisma, secondId);
      state.sessionActive = false;
    } else {
      await Bun.sleep(10);
      state.secondReplyObservedWhileFirstBlocked = state.replyCalls > 1;
    }
    state.releaseConcurrentGate?.();
    await Promise.all([first, second]);
  } else {
    await invokeFlowHandler(
      options.handler,
      messageContext({
        messageId: firstId,
        ...(options.scenario === "agent-run-persistence"
          ? { content: "ASSEMBLED_PROMPT_CONTENT_SENTINEL" }
          : {}),
      }),
    );
  }

  const rows = await queryScenarioRuns(options.prisma, messageIds);
  let agentRunColumns: string[] = [];
  let serializedAgentRuns = JSON.stringify(rows);
  if (options.scenario === "agent-run-persistence") {
    const database = new Database(options.databasePath, {
      readonly: true,
      strict: true,
    });
    try {
      agentRunColumns = ColumnRowsSchema.parse(
        database
          .query<{ name: string }, []>("PRAGMA table_info('AgentRun')")
          .all(),
      ).map((row) => row.name);
      const persistedRows: unknown = database
        .query("SELECT * FROM AgentRun WHERE discordMessageId = ?")
        .all(firstId);
      serializedAgentRuns = JSON.stringify(persistedRows);
    } finally {
      database.close();
    }
  }

  return {
    scenario: options.scenario,
    runStatuses: rows.map((row) => row.status),
    replyCalls: state.replyCalls,
    replyPayloads: state.replyPayloads,
    editAttempts: state.editAttempts,
    deliveredEdits: state.deliveredEdits,
    contextCalls: state.contextCalls,
    routerCalls: state.routerCalls,
    directCalls: state.directCalls,
    specialistCalls: state.specialistCalls,
    toolCalls: state.toolCalls,
    memoryExtractionCalls: state.memoryExtractionCalls,
    sessionEventCalls: state.sessionEventCalls,
    deliveryOrder: state.deliveryOrder,
    incidentIds: rows.flatMap((row) =>
      row.incidentId == null ? [] : [row.incidentId],
    ),
    responseMessageIds: rows.flatMap((row) =>
      row.responseMessageId == null ? [] : [row.responseMessageId],
    ),
    errorClasses: rows.flatMap((row) =>
      row.errorClass == null ? [] : [row.errorClass],
    ),
    finishReasons: rows.flatMap((row) =>
      row.finishReason == null ? [] : [row.finishReason],
    ),
    agentRunColumns,
    serializedAgentRuns,
    secondReplyObservedWhileFirstBlocked:
      state.secondReplyObservedWhileFirstBlocked,
  };
}

async function main(): Promise<void> {
  const databasePath = z.string().min(1).parse(Bun.env["DATABASE_PATH"]);
  const databaseUrl = z.string().min(1).parse(Bun.env["DATABASE_URL"]);
  if (databaseUrl !== `file:${databasePath}`) {
    throw new Error("Flow harness DATABASE_URL and DATABASE_PATH must agree");
  }
  const { deployDatabaseMigrations } =
    await import("@shepherdjerred/birmel/database/migration-bootstrap.ts");
  await deployDatabaseMigrations(Bun.env);
  const agentRuns =
    await import("@shepherdjerred/birmel/agent-runtime/agent-runs.ts");
  const completeAgentRun = agentRuns.completeAgentRun;
  const completeAgentRunWithFailure: typeof completeAgentRun = async (
    options,
  ) => {
    if (state.scenario === "agent-run-completion-failure") {
      throw new Error("AGENT_RUN_PERSISTENCE_SECRET_EXCEPTION");
    }
    await completeAgentRun(options);
  };
  void mock.module(
    "@shepherdjerred/birmel/agent-runtime/agent-runs.ts",
    () => ({ ...agentRuns, completeAgentRun: completeAgentRunWithFailure }),
  );
  const [{ handleMessage }, { prisma, disconnectPrisma }] = await Promise.all([
    import("@shepherdjerred/birmel/agent-runtime/message-handler.ts"),
    import("@shepherdjerred/birmel/database/index.ts"),
  ]);
  try {
    const results: FlowScenarioResult[] = [];
    for (const [index, scenario] of scenarios.entries()) {
      results.push(
        await runScenario({
          scenario,
          index,
          handler: handleMessage,
          prisma,
          databasePath,
        }),
      );
    }
    const output = FlowHarnessResultSchema.parse({ scenarios: results });
    process.stdout.write(`${FLOW_RESULT_PREFIX}${JSON.stringify(output)}\n`);
  } finally {
    await disconnectPrisma();
  }
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
