import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestDatabase } from "#src/testing/test-database.ts";
import type { DiscordAccountId } from "@scout-for-lol/data";
import { testAccountId } from "#src/testing/test-ids.ts";
import {
  ExploreInvalidTurnError,
  ExploreNotFoundError,
  appendExploreAnswer,
  deleteExploreConversation,
  listExploreConversations,
  loadExploreTranscript,
  loadSharedExploreTranscript,
  renameExploreConversation,
  resolveRegenerateTarget,
  revokeExploreShare,
  setExploreLeaf,
  shareExploreConversation,
  startExploreTurn,
  titleFromQuestion,
} from "#src/explore/store.ts";

const { prisma } = createTestDatabase("explore-store-test");
const userId = testAccountId("1");
const otherUserId = testAccountId("2");

async function seedUser(discordId: DiscordAccountId): Promise<void> {
  await prisma.user.upsert({
    where: { discordId },
    create: { discordId, discordUsername: `user-${discordId}` },
    update: {},
  });
}

beforeEach(async () => {
  await prisma.exploreMessage.deleteMany();
  await prisma.exploreConversation.deleteMany();
  await prisma.user.deleteMany();
  await seedUser(userId);
  await seedUser(otherUserId);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const ANSWER = {
  answer: "Jinx has the most games in this data.",
  queryText: "SELECT champion, games FROM match_participants GROUP BY champion",
  caveats: ["Only 12 games."],
  followUps: ["How does that change by patch?"],
};

/** Ask a question and answer it, returning both message ids. */
async function askAndAnswer(input: {
  conversationId: string | null;
  question: string;
  parentMessageId?: string | null;
  answer?: string;
}): Promise<{
  conversationId: string;
  questionId: string;
  answerId: string;
}> {
  const started = await startExploreTurn(prisma, {
    conversationId: input.conversationId,
    userId,
    question: input.question,
    parentMessageId: input.parentMessageId ?? null,
  });
  const answer = await appendExploreAnswer(prisma, {
    conversationId: started.conversationId,
    parentMessageId: started.messageId,
    answer: { ...ANSWER, answer: input.answer ?? ANSWER.answer },
    preview: null,
    visualization: null,
    trace: [
      { toolName: "run_report_query", message: "Got results.", ok: true },
    ],
  });
  return {
    conversationId: started.conversationId,
    questionId: started.messageId,
    answerId: answer.id,
  };
}

async function path(conversationId: string): Promise<string[]> {
  const transcript = await loadExploreTranscript(
    prisma,
    conversationId,
    userId,
  );
  return (transcript?.messages ?? []).map((message) => message.content);
}

describe("explore store", () => {
  test("a new conversation is titled from its opening question", async () => {
    const started = await startExploreTurn(prisma, {
      conversationId: null,
      userId,
      question: "Which champion has the most games?",
      parentMessageId: null,
    });
    expect(started.title).toBe("Which champion has the most games?");

    const transcript = await loadExploreTranscript(
      prisma,
      started.conversationId,
      userId,
    );
    expect(transcript?.messages).toHaveLength(1);
    expect(transcript?.messages[0]?.role).toBe("user");
    expect(transcript?.messages[0]?.parentId).toBeNull();
  });

  test("a linear conversation reads back in order", async () => {
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });
    await askAndAnswer({
      conversationId: first.conversationId,
      question: "And by patch?",
      answer: "It shifts toward Caitlyn.",
    });

    expect(await path(first.conversationId)).toEqual([
      "Which champion has the most games?",
      ANSWER.answer,
      "And by patch?",
      "It shifts toward Caitlyn.",
    ]);
  });

  test("the answer round-trips its JSON columns including the trace", async () => {
    const { conversationId } = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });
    const transcript = await loadExploreTranscript(
      prisma,
      conversationId,
      userId,
    );
    const assistant = transcript?.messages[1];
    expect(assistant?.queryText).toBe(ANSWER.queryText);
    expect(assistant?.caveats).toEqual(ANSWER.caveats);
    expect(assistant?.followUps).toEqual(ANSWER.followUps);
    expect(assistant?.trace).toEqual([
      { toolName: "run_report_query", message: "Got results.", ok: true },
    ]);
  });
});

describe("explore store — branching", () => {
  test("editing a question forks a branch and leaves the original reachable", async () => {
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });
    const second = await askAndAnswer({
      conversationId: first.conversationId,
      question: "And by patch?",
      answer: "It shifts toward Caitlyn.",
    });

    // Edit: attach a sibling under the same parent as the original question.
    const edited = await askAndAnswer({
      conversationId: first.conversationId,
      question: "And by queue?",
      parentMessageId: first.answerId,
      answer: "ARAM skews it hard.",
    });

    // The new branch is what you land on…
    expect(await path(first.conversationId)).toEqual([
      "Which champion has the most games?",
      ANSWER.answer,
      "And by queue?",
      "ARAM skews it hard.",
    ]);
    // …and nothing was destroyed to get there.
    expect(await prisma.exploreMessage.count()).toBe(6);

    // Both versions know they are one of two.
    const transcript = await loadExploreTranscript(
      prisma,
      first.conversationId,
      userId,
    );
    const forked = transcript?.messages[2];
    expect(forked?.versionCount).toBe(2);
    expect(forked?.versionIndex).toBe(1);

    // Switching back restores the original branch in full.
    expect(
      await setExploreLeaf(
        prisma,
        first.conversationId,
        userId,
        second.questionId,
      ),
    ).toBe(true);
    expect(await path(first.conversationId)).toEqual([
      "Which champion has the most games?",
      ANSWER.answer,
      "And by patch?",
      "It shifts toward Caitlyn.",
    ]);
    expect(edited.answerId).not.toBe(second.answerId);
  });

  test("regenerating forks the answer, not the question", async () => {
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });

    const target = await resolveRegenerateTarget(prisma, {
      conversationId: first.conversationId,
      userId,
      parentMessageId: first.questionId,
    });
    expect(target.question).toBe("Which champion has the most games?");

    await appendExploreAnswer(prisma, {
      conversationId: first.conversationId,
      parentMessageId: target.messageId,
      answer: { ...ANSWER, answer: "Actually Caitlyn edges it." },
      preview: null,
      visualization: null,
      trace: [],
    });

    // One question, two answers — the arrows belong on the answer.
    expect(await path(first.conversationId)).toEqual([
      "Which champion has the most games?",
      "Actually Caitlyn edges it.",
    ]);
    const transcript = await loadExploreTranscript(
      prisma,
      first.conversationId,
      userId,
    );
    expect(transcript?.messages[0]?.versionCount).toBe(1);
    expect(transcript?.messages[1]?.versionCount).toBe(2);
  });

  test("regenerating refuses to answer an answer", async () => {
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });
    await expect(
      resolveRegenerateTarget(prisma, {
        conversationId: first.conversationId,
        userId,
        parentMessageId: first.answerId,
      }),
    ).rejects.toBeInstanceOf(ExploreInvalidTurnError);
  });

  test("a share pins its path, so later branching cannot change the link", async () => {
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });
    await askAndAnswer({
      conversationId: first.conversationId,
      question: "And by patch?",
      answer: "It shifts toward Caitlyn.",
    });

    const token = await shareExploreConversation(
      prisma,
      first.conversationId,
      userId,
    );
    expect(token).toMatch(/^[0-9a-f]{32}$/);

    // A returned token that was never written would be a link that can only
    // ever 404, so the persisted row is what the caller was promised.
    const stored = await prisma.exploreConversation.findUnique({
      where: { id: first.conversationId },
      select: { shareToken: true, sharedLeafId: true, sharedAt: true },
    });
    expect(stored?.shareToken).toBe(token);
    expect(stored?.sharedLeafId).not.toBeNull();
    expect(stored?.sharedAt).not.toBeNull();

    // The owner branches after sharing.
    await askAndAnswer({
      conversationId: first.conversationId,
      question: "And by queue?",
      parentMessageId: first.answerId,
      answer: "ARAM skews it hard.",
    });

    // The recipient still sees exactly what was shared.
    const shared = await loadSharedExploreTranscript(prisma, token ?? "");
    expect(shared?.messages.map((message) => message.content)).toEqual([
      "Which champion has the most games?",
      ANSWER.answer,
      "And by patch?",
      "It shifts toward Caitlyn.",
    ]);
    // …while the owner is reading the new branch.
    expect(await path(first.conversationId)).toContain("ARAM skews it hard.");
  });

  test("sharing a conversation that no longer exists mints nothing", async () => {
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });
    await deleteExploreConversation(prisma, first.conversationId, userId);

    expect(
      await shareExploreConversation(prisma, first.conversationId, userId),
    ).toBeNull();
  });

  test("sharing is stable and revocable", async () => {
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });
    const token = await shareExploreConversation(
      prisma,
      first.conversationId,
      userId,
    );
    // Re-sharing keeps the link someone may already have been sent.
    expect(
      await shareExploreConversation(prisma, first.conversationId, userId),
    ).toBe(token);

    expect(await revokeExploreShare(prisma, first.conversationId, userId)).toBe(
      true,
    );
    expect(await loadSharedExploreTranscript(prisma, token ?? "")).toBeNull();
  });
});

describe("explore store — ownership", () => {
  test("a conversation is only reachable by its owner", async () => {
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });

    expect(
      await loadExploreTranscript(prisma, first.conversationId, otherUserId),
    ).toBeNull();
    expect(await listExploreConversations(prisma, otherUserId)).toEqual([]);
    expect(
      await deleteExploreConversation(
        prisma,
        first.conversationId,
        otherUserId,
      ),
    ).toBe(false);
    expect(
      await renameExploreConversation(
        prisma,
        first.conversationId,
        otherUserId,
        "stolen",
      ),
    ).toBe(false);
    expect(
      await shareExploreConversation(prisma, first.conversationId, otherUserId),
    ).toBeNull();
    expect(
      await setExploreLeaf(
        prisma,
        first.conversationId,
        otherUserId,
        first.questionId,
      ),
    ).toBe(false);
  });

  test("continuing another user's conversation is refused", async () => {
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });

    await expect(
      startExploreTurn(prisma, {
        conversationId: first.conversationId,
        userId: otherUserId,
        question: "Sneaking in.",
        parentMessageId: null,
      }),
    ).rejects.toBeInstanceOf(ExploreNotFoundError);
  });

  test("attaching to a message from another conversation is refused", async () => {
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });
    const other = await askAndAnswer({
      conversationId: null,
      question: "Unrelated.",
    });

    await expect(
      startExploreTurn(prisma, {
        conversationId: first.conversationId,
        userId,
        question: "Grafting on.",
        parentMessageId: other.answerId,
      }),
    ).rejects.toBeInstanceOf(ExploreNotFoundError);
  });

  test("deleting a conversation removes its messages", async () => {
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });
    expect(
      await deleteExploreConversation(prisma, first.conversationId, userId),
    ).toBe(true);
    expect(await prisma.exploreMessage.count()).toBe(0);
  });

  test("a long question is truncated into a usable title", () => {
    const title = titleFromQuestion(`  ${"a".repeat(400)}  `);
    expect(title).toHaveLength(120);
    expect(title.endsWith("…")).toBe(true);
  });
});
