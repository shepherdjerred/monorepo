import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  ExploreTraceEntrySchema,
  type DiscordAccountId,
  type ExploreAttachPoint,
} from "@scout-for-lol/data";
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
import {
  applyGeneratedTitle,
  rollbackGeneratedTitle,
} from "#src/explore/generated-title.ts";

const { prisma } = createTestDatabase("explore-store-test");
const userId = testAccountId("1");
const otherUserId = testAccountId("2");
const TRACE_ENTRY = ExploreTraceEntrySchema.parse({
  toolName: "run_report_query",
  message: "Got results.",
  ok: true,
});

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
  title: null,
  queryText: "SELECT champion, games FROM match_participants GROUP BY champion",
  caveats: ["Only 12 games."],
  followUps: ["How does that change by patch?"],
};

/** Ask a question and answer it, returning both message ids. */
async function askAndAnswer(input: {
  conversationId: string | null;
  question: string;
  attach?: ExploreAttachPoint;
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
    attach: input.attach ?? { kind: "leaf" },
  });
  const answer = await appendExploreAnswer(prisma, {
    conversationId: started.conversationId,
    parentMessageId: started.messageId,
    answer: { ...ANSWER, answer: input.answer ?? ANSWER.answer },
    preview: null,
    visualization: null,
    trace: [TRACE_ENTRY],
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
  /**
   * The question is written before the model runs so an abandoned turn stays
   * resumable. That only holds if the branch moves onto it: the transcript is
   * read by `currentLeafId`, so a question left off the path is in the
   * database but invisible to the person who just asked it.
   */
  test("a question is on the path before its answer exists", async () => {
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });

    // A follow-up whose turn then dies before any answer is appended.
    await startExploreTurn(prisma, {
      conversationId: first.conversationId,
      userId,
      question: "And by patch?",
      attach: { kind: "leaf" },
    });

    expect(await path(first.conversationId)).toEqual([
      "Which champion has the most games?",
      ANSWER.answer,
      "And by patch?",
    ]);
  });

  test("a new conversation is titled from its opening question", async () => {
    const started = await startExploreTurn(prisma, {
      conversationId: null,
      userId,
      question: "Which champion has the most games?",
      attach: { kind: "leaf" },
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
    expect(assistant?.trace).toEqual([TRACE_ENTRY]);
  });
});

describe("explore store — background branches", () => {
  test("a background answer does not move a branch another tab selected", async () => {
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });
    const patchBranch = await askAndAnswer({
      conversationId: first.conversationId,
      question: "And by patch?",
      answer: "Patch 26.15 favors Jinx.",
    });
    const queueBranch = await askAndAnswer({
      conversationId: first.conversationId,
      question: "And by queue?",
      attach: { kind: "message", messageId: first.answerId },
      answer: "ARAM favors Caitlyn.",
    });
    await setExploreLeaf(
      prisma,
      first.conversationId,
      userId,
      patchBranch.answerId,
    );
    const running = await startExploreTurn(prisma, {
      conversationId: first.conversationId,
      userId,
      question: "What about this week?",
      attach: { kind: "leaf" },
    });

    // Another tab switches back while the follow-up is still running.
    expect(
      await setExploreLeaf(
        prisma,
        first.conversationId,
        userId,
        queueBranch.questionId,
      ),
    ).toBe(true);
    const backgroundAnswer = await appendExploreAnswer(prisma, {
      conversationId: first.conversationId,
      parentMessageId: running.messageId,
      answer: { ...ANSWER, answer: "Patch 26.16 favors Caitlyn." },
      preview: null,
      visualization: null,
      trace: [],
      expectedCurrentLeafId: running.expectedCurrentLeafId,
    });

    expect(await path(first.conversationId)).toEqual([
      "Which champion has the most games?",
      ANSWER.answer,
      "And by queue?",
      "ARAM favors Caitlyn.",
    ]);
    const stored = await prisma.exploreMessage.findUnique({
      where: { id: backgroundAnswer.id },
    });
    expect(stored?.parentId).toBe(running.messageId);
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
      attach: { kind: "message", messageId: first.answerId },
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

  test("editing the opening question forks a second root", async () => {
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });

    // The root's parentId is null, so only `kind: "root"` can express this
    // fork — a parent id cannot name "no parent".
    const edited = await askAndAnswer({
      conversationId: first.conversationId,
      question: "Which champion has the most wins?",
      attach: { kind: "root" },
      answer: "Caitlyn, narrowly.",
    });

    // The edited branch is what you land on…
    expect(await path(first.conversationId)).toEqual([
      "Which champion has the most wins?",
      "Caitlyn, narrowly.",
    ]);
    // …and nothing was destroyed to get there.
    expect(await prisma.exploreMessage.count()).toBe(4);

    // Both opening questions are root siblings with version arrows.
    const transcript = await loadExploreTranscript(
      prisma,
      first.conversationId,
      userId,
    );
    const root = transcript?.messages[0];
    expect(root?.parentId).toBeNull();
    expect(root?.versionCount).toBe(2);
    expect(root?.versionIndex).toBe(1);
    expect(root?.siblingIds).toEqual([first.questionId, edited.questionId]);

    // Switching back restores the original opening branch in full.
    expect(
      await setExploreLeaf(
        prisma,
        first.conversationId,
        userId,
        first.questionId,
      ),
    ).toBe(true);
    expect(await path(first.conversationId)).toEqual([
      "Which champion has the most games?",
      ANSWER.answer,
    ]);
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
      attach: { kind: "message", messageId: first.answerId },
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
        attach: { kind: "leaf" },
      }),
    ).rejects.toBeInstanceOf(ExploreNotFoundError);
  });

  test("a stale currentLeafId is refused as a 404, not a database fault", async () => {
    // `deepestLeafFrom` returns the pointer unchanged when nothing descends
    // from it, without checking it is a node at all. The foreign key on
    // `parentId` refuses the write either way, so nothing is corrupted — but
    // unguarded it arrives as a raw Prisma constraint violation, which this
    // module does not classify and the route answers 500. Asserting the domain
    // error is what pins it to the 404 a missing parent deserves.
    const first = await askAndAnswer({
      conversationId: null,
      question: "Which champion has the most games?",
    });
    await prisma.exploreConversation.update({
      where: { id: first.conversationId },
      data: { currentLeafId: "44444444-4444-4444-8444-444444444444" },
    });

    await expect(
      startExploreTurn(prisma, {
        conversationId: first.conversationId,
        userId,
        question: "Follow-up onto a pointer that is not in the tree.",
        attach: { kind: "leaf" },
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
        attach: { kind: "message", messageId: other.answerId },
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
});

describe("explore store — titles", () => {
  test("a long question is truncated into a usable title", () => {
    const title = titleFromQuestion(`  ${"a".repeat(400)}  `);
    expect(title).toHaveLength(120);
    expect(title.endsWith("…")).toBe(true);
  });

  test("the agent's title replaces the question-derived placeholder", async () => {
    const started = await startExploreTurn(prisma, {
      conversationId: null,
      userId,
      question: "Which champions have the highest win rate?",
      attach: { kind: "leaf" },
    });

    const applied = await applyGeneratedTitle(prisma, {
      conversationId: started.conversationId,
      title: "Top win rates by champion",
    });

    expect(applied.title).toBe("Top win rates by champion");
    expect(applied.rollback).toEqual({
      generatedTitle: "Top win rates by champion",
      placeholderTitle: "Which champions have the highest win rate?",
    });
    const row = await prisma.exploreConversation.findUniqueOrThrow({
      where: { id: started.conversationId },
    });
    expect(row.title).toBe("Top win rates by champion");
  });

  test("a title arriving after a rename does not clobber it", async () => {
    const started = await startExploreTurn(prisma, {
      conversationId: null,
      userId,
      question: "Which champions have the highest win rate?",
      attach: { kind: "leaf" },
    });
    await renameExploreConversation(
      prisma,
      started.conversationId,
      userId,
      "Mine",
    );

    const applied = await applyGeneratedTitle(prisma, {
      conversationId: started.conversationId,
      title: "Top win rates by champion",
    });

    // Reports the title that is actually on the row, not the placeholder the
    // conversation has already moved off.
    expect(applied).toEqual({ title: "Mine", rollback: null });
    const row = await prisma.exploreConversation.findUniqueOrThrow({
      where: { id: started.conversationId },
    });
    expect(row.title).toBe("Mine");
  });

  test("generated-title rollback does not clobber a later rename", async () => {
    const started = await startExploreTurn(prisma, {
      conversationId: null,
      userId,
      question: "Which champions have the highest win rate?",
      attach: { kind: "leaf" },
    });
    const applied = await applyGeneratedTitle(prisma, {
      conversationId: started.conversationId,
      title: "Top win rates by champion",
    });
    if (applied.rollback === null) {
      throw new Error("Expected the generated title to be applied.");
    }
    await renameExploreConversation(
      prisma,
      started.conversationId,
      userId,
      "Mine",
    );

    await rollbackGeneratedTitle(prisma, {
      conversationId: started.conversationId,
      ...applied.rollback,
    });

    const row = await prisma.exploreConversation.findUniqueOrThrow({
      where: { id: started.conversationId },
    });
    expect(row.title).toBe("Mine");
  });

  test("a second turn's title leaves the established one alone", async () => {
    const started = await startExploreTurn(prisma, {
      conversationId: null,
      userId,
      question: "Which champions have the highest win rate?",
      attach: { kind: "leaf" },
    });
    await applyGeneratedTitle(prisma, {
      conversationId: started.conversationId,
      title: "Top win rates by champion",
    });

    // The placeholder derived from the opening question no longer matches the
    // row, so the follow-up's title is ignored.
    const applied = await applyGeneratedTitle(prisma, {
      conversationId: started.conversationId,
      title: "Something else entirely",
    });

    expect(applied).toEqual({
      title: "Top win rates by champion",
      rollback: null,
    });
    const row = await prisma.exploreConversation.findUniqueOrThrow({
      where: { id: started.conversationId },
    });
    expect(row.title).toBe("Top win rates by champion");
  });

  test("a real follow-up turn cannot replace an established title", async () => {
    // Drives the turn the route actually runs rather than replaying the first
    // turn's placeholder by hand. That difference is the bug this pins: the
    // route holds `startExploreTurn`'s title, which on a follow-up is the
    // *established* one, so a caller-supplied placeholder matched itself and
    // overwrote the title on every later turn.
    const first = await startExploreTurn(prisma, {
      conversationId: null,
      userId,
      question: "Which champions have the highest win rate?",
      attach: { kind: "leaf" },
    });
    await applyGeneratedTitle(prisma, {
      conversationId: first.conversationId,
      title: "Top win rates by champion",
    });

    const followUp = await startExploreTurn(prisma, {
      conversationId: first.conversationId,
      userId,
      question: "And by position?",
      attach: { kind: "leaf" },
    });
    expect(followUp.title).toBe("Top win rates by champion");

    const applied = await applyGeneratedTitle(prisma, {
      conversationId: followUp.conversationId,
      title: "Win rates by position",
    });

    expect(applied).toEqual({
      title: "Top win rates by champion",
      rollback: null,
    });
    const row = await prisma.exploreConversation.findUniqueOrThrow({
      where: { id: first.conversationId },
    });
    expect(row.title).toBe("Top win rates by champion");
  });

  test("a manual rename survives a later turn's generated title", async () => {
    const first = await startExploreTurn(prisma, {
      conversationId: null,
      userId,
      question: "Which champions have the highest win rate?",
      attach: { kind: "leaf" },
    });
    await renameExploreConversation(
      prisma,
      first.conversationId,
      userId,
      "Mine",
    );

    const followUp = await startExploreTurn(prisma, {
      conversationId: first.conversationId,
      userId,
      question: "And by position?",
      attach: { kind: "leaf" },
    });
    const applied = await applyGeneratedTitle(prisma, {
      conversationId: followUp.conversationId,
      title: "Win rates by position",
    });

    expect(applied).toEqual({ title: "Mine", rollback: null });
    const row = await prisma.exploreConversation.findUniqueOrThrow({
      where: { id: first.conversationId },
    });
    expect(row.title).toBe("Mine");
  });
});
