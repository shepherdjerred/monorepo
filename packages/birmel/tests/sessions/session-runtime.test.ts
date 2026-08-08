import { afterEach, describe, expect, test } from "bun:test";

const {
  appendSessionEvent,
  createSession,
  getActiveSessionForThread,
  getSessionContext,
  SessionEventRoleSchema,
  updateSessionStatus,
} = await import("@shepherdjerred/birmel/sessions/service.ts");
const { summarizeSessionIfNeeded } =
  await import("@shepherdjerred/birmel/sessions/summarization.ts");
const { manageAgentSessionTool } =
  await import("@shepherdjerred/birmel/agent-tools/tools/sessions/index.ts");
const { prisma } = await import("@shepherdjerred/birmel/database/index.ts");

let fixtureNumber = 0;

async function createFixture(
  options: {
    threadId?: string;
    status?: "active" | "archived" | "cancelled";
  } = {},
) {
  fixtureNumber += 1;
  const session = await createSession({
    guildId: "guild-session-test",
    channelId: "channel-session-test",
    threadId: options.threadId ?? `thread-${String(fixtureNumber)}`,
    actorUserId: "trusted-actor",
    label: `Session ${String(fixtureNumber)}`,
  });
  if (options.status != null && options.status !== "active") {
    await updateSessionStatus({
      sessionId: session.id,
      guildId: session.guildId,
      status: options.status,
    });
  }
  return session;
}

async function appendNumberedEvent(
  sessionId: string,
  sequenceHint: number,
): Promise<void> {
  const eventType = `event-${String(sequenceHint)}`;
  const content = `content-${String(sequenceHint)}`;
  const remainder = sequenceHint % 3;
  if (remainder === 0) {
    await appendSessionEvent({
      sessionId,
      role: "user",
      eventType,
      content,
      discordMessageId: `message-${String(sequenceHint)}`,
    });
    return;
  }
  if (remainder === 1) {
    await appendSessionEvent({
      sessionId,
      role: "assistant",
      eventType,
      content,
      discordMessageId: `message-${String(sequenceHint)}`,
    });
    return;
  }
  await appendSessionEvent({
    sessionId,
    role: "tool",
    eventType,
    content,
    toolId: "test-tool",
  });
}

afterEach(async () => {
  await prisma.agentSession.deleteMany({
    where: { guildId: "guild-session-test" },
  });
});

describe("thread-bound sessions", () => {
  test("allows only one session record per Discord thread", async () => {
    const first = await createFixture({ threadId: "thread-unique" });

    expect(first.threadId).toBe("thread-unique");
    await expect(
      createSession({
        guildId: "guild-session-test",
        channelId: "different-channel",
        threadId: "thread-unique",
        actorUserId: "trusted-actor",
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(
      await prisma.agentSession.count({ where: { threadId: "thread-unique" } }),
    ).toBe(1);
  });

  test("looks up only active sessions for thread admission", async () => {
    const session = await createFixture({ threadId: "thread-active" });

    expect(await getActiveSessionForThread("thread-active")).toMatchObject({
      id: session.id,
      status: "active",
    });
    expect(await getActiveSessionForThread("thread-missing")).toBeNull();
  });

  test("archive, cancel, and resume change active thread routing state", async () => {
    const session = await createFixture({ threadId: "thread-lifecycle" });

    expect(
      await updateSessionStatus({
        sessionId: session.id,
        guildId: session.guildId,
        status: "archived",
      }),
    ).toBeTrue();
    expect(await getActiveSessionForThread(session.threadId)).toBeNull();

    expect(
      await updateSessionStatus({
        sessionId: session.id,
        guildId: session.guildId,
        status: "active",
      }),
    ).toBeTrue();
    expect(await getActiveSessionForThread(session.threadId)).toMatchObject({
      status: "active",
      archivedAt: null,
      cancelledAt: null,
    });

    expect(
      await updateSessionStatus({
        sessionId: session.id,
        guildId: session.guildId,
        status: "cancelled",
      }),
    ).toBeTrue();
    expect(await getActiveSessionForThread(session.threadId)).toBeNull();

    expect(
      await updateSessionStatus({
        sessionId: session.id,
        guildId: session.guildId,
        status: "active",
      }),
    ).toBeTrue();
    expect(await getActiveSessionForThread(session.threadId)).toMatchObject({
      status: "active",
      archivedAt: null,
      cancelledAt: null,
    });
  });
});

describe("session event log", () => {
  test("stores append-only user, assistant, and tool events in monotonic order", async () => {
    const session = await createFixture();

    await appendSessionEvent({
      sessionId: session.id,
      role: "user",
      eventType: "discord-message",
      content: "first",
      discordMessageId: "discord-user-message",
    });
    await appendSessionEvent({
      sessionId: session.id,
      role: "assistant",
      eventType: "discord-reply",
      content: "second",
      discordMessageId: "discord-assistant-message",
    });
    await appendSessionEvent({
      sessionId: session.id,
      role: "tool",
      eventType: "tool-result",
      content: "third",
      toolId: "read-channel",
    });

    const events = await prisma.agentSessionEvent.findMany({
      where: { sessionId: session.id },
      orderBy: { sequence: "asc" },
    });
    expect(events.map(({ sequence, role }) => ({ sequence, role }))).toEqual([
      { sequence: 1, role: "user" },
      { sequence: 2, role: "assistant" },
      { sequence: 3, role: "tool" },
    ]);
    expect(events[0]?.discordMessageId).toBe("discord-user-message");
    expect(events[1]?.discordMessageId).toBe("discord-assistant-message");
    expect(events[2]?.toolId).toBe("read-channel");
  });

  test("serializes concurrent appends into unique monotonic sequence numbers", async () => {
    const session = await createFixture();

    await Promise.all(
      Array.from({ length: 18 }, async (_, index) => {
        await appendNumberedEvent(session.id, index + 1);
      }),
    );

    const events = await prisma.agentSessionEvent.findMany({
      where: { sessionId: session.id },
      orderBy: { sequence: "asc" },
    });
    expect(events).toHaveLength(18);
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 1),
    );
    expect(new Set(events.map((event) => event.sequence)).size).toBe(18);
    expect(new Set(events.map((event) => event.content)).size).toBe(18);
  });

  test("does not admit reasoning as a persisted event role", () => {
    expect(SessionEventRoleSchema.options).toEqual([
      "user",
      "assistant",
      "tool",
    ]);
    expect(SessionEventRoleSchema.safeParse("reasoning").success).toBeFalse();
  });

  test("resumes context from the versioned summary and only later events", async () => {
    const session = await createFixture();
    for (let index = 1; index <= 5; index += 1) {
      await appendNumberedEvent(session.id, index);
    }
    await prisma.agentSession.update({
      where: { id: session.id },
      data: {
        summary: "Version two summary",
        summaryVersion: 2,
        summaryThroughSequence: 3,
      },
    });

    const context = await getSessionContext(session.id);

    expect(context.summary).toBe("Version two summary");
    expect(context.events.map((event) => event.sequence)).toEqual([4, 5]);
    expect(context.events.map((event) => event.content)).toEqual([
      "content-4",
      "content-5",
    ]);
  });
});

describe("session summarization", () => {
  test("increments the summary version and preserves the sixteen-event tail", async () => {
    const session = await createFixture();
    for (let index = 1; index <= 20; index += 1) {
      await appendNumberedEvent(session.id, index);
    }
    const calls: {
      previousSummary: string | null;
      events: { sequence: number; role: string; content: string }[];
    }[] = [];

    const summarized = await summarizeSessionIfNeeded(
      session.id,
      async (input) => {
        calls.push(input);
        return "Summary through event four";
      },
    );

    expect(summarized).toBeTrue();
    expect(calls).toEqual([
      {
        previousSummary: null,
        events: [
          { sequence: 1, role: "assistant", content: "content-1" },
          { sequence: 2, role: "tool", content: "content-2" },
          { sequence: 3, role: "user", content: "content-3" },
          { sequence: 4, role: "assistant", content: "content-4" },
        ],
      },
    ]);
    expect(
      await prisma.agentSession.findUniqueOrThrow({
        where: { id: session.id },
        select: {
          summary: true,
          summaryVersion: true,
          summaryThroughSequence: true,
        },
      }),
    ).toEqual({
      summary: "Summary through event four",
      summaryVersion: 2,
      summaryThroughSequence: 4,
    });
    const context = await getSessionContext(session.id);
    expect(context.events).toHaveLength(16);
    expect(context.events[0]?.sequence).toBe(5);
    expect(context.events.at(-1)?.sequence).toBe(20);
  });

  test("does not summarize until more than sixteen events are pending", async () => {
    const session = await createFixture();
    for (let index = 1; index <= 16; index += 1) {
      await appendNumberedEvent(session.id, index);
    }
    let calls = 0;

    const summarized = await summarizeSessionIfNeeded(session.id, async () => {
      calls += 1;
      return "Unexpected summary";
    });

    expect(summarized).toBeFalse();
    expect(calls).toBe(0);
    expect(
      await prisma.agentSession.findUniqueOrThrow({
        where: { id: session.id },
        select: {
          summary: true,
          summaryVersion: true,
          summaryThroughSequence: true,
        },
      }),
    ).toEqual({ summary: null, summaryVersion: 1, summaryThroughSequence: 0 });
  });
});

describe("session tool contract", () => {
  test("exposes lifecycle actions without inert follow-up controls", () => {
    const allowedActions = [
      "create",
      "list",
      "get",
      "history",
      "cancel",
      "archive",
      "resume",
    ];
    for (const action of allowedActions) {
      expect(
        manageAgentSessionTool.inputSchema.safeParse({
          action,
          guildId: "guild-session-test",
        }).success,
      ).toBeTrue();
    }

    for (const action of ["follow-up", "steer", "spawn", "set-options"]) {
      expect(
        manageAgentSessionTool.inputSchema.safeParse({
          action,
          guildId: "guild-session-test",
        }).success,
      ).toBeFalse();
    }
  });
});
