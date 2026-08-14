import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestDatabase } from "#src/testing/test-database.ts";
import type { DiscordAccountId } from "@scout-for-lol/data";
import { testAccountId } from "#src/testing/test-ids.ts";
import {
  appendExploreAnswer,
  deleteExploreConversation,
  listExploreConversations,
  loadExploreTranscript,
  loadSharedExploreTranscript,
  renameExploreConversation,
  revokeExploreShare,
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

describe("explore store", () => {
  test("a new conversation is titled from its opening question", async () => {
    const started = await startExploreTurn(prisma, {
      conversationId: null,
      userId,
      question: "Which champion has the most games?",
    });
    expect(started.title).toBe("Which champion has the most games?");
    expect(started.ordinal).toBe(0);

    const transcript = await loadExploreTranscript(
      prisma,
      started.conversationId,
      userId,
    );
    expect(transcript?.messages).toHaveLength(1);
    expect(transcript?.messages[0]?.role).toBe("user");
  });

  test("turns append in order and the answer round-trips its JSON columns", async () => {
    const first = await startExploreTurn(prisma, {
      conversationId: null,
      userId,
      question: "Which champion has the most games?",
    });
    await appendExploreAnswer(prisma, {
      conversationId: first.conversationId,
      ordinal: first.ordinal + 1,
      answer: ANSWER,
      preview: null,
      visualization: null,
    });
    const second = await startExploreTurn(prisma, {
      conversationId: first.conversationId,
      userId,
      question: "And by patch?",
    });
    expect(second.ordinal).toBe(2);

    const transcript = await loadExploreTranscript(
      prisma,
      first.conversationId,
      userId,
    );
    expect(transcript?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    const assistant = transcript?.messages[1];
    expect(assistant?.content).toBe(ANSWER.answer);
    expect(assistant?.queryText).toBe(ANSWER.queryText);
    expect(assistant?.caveats).toEqual(ANSWER.caveats);
    expect(assistant?.followUps).toEqual(ANSWER.followUps);
  });

  test("a conversation is only readable by its owner", async () => {
    const started = await startExploreTurn(prisma, {
      conversationId: null,
      userId,
      question: "Which champion has the most games?",
    });

    expect(
      await loadExploreTranscript(prisma, started.conversationId, otherUserId),
    ).toBeNull();
    expect(await listExploreConversations(prisma, otherUserId)).toEqual([]);
    expect(
      await deleteExploreConversation(
        prisma,
        started.conversationId,
        otherUserId,
      ),
    ).toBe(false);
    expect(
      await renameExploreConversation(
        prisma,
        started.conversationId,
        otherUserId,
        "stolen",
      ),
    ).toBe(false);
    expect(
      await shareExploreConversation(
        prisma,
        started.conversationId,
        otherUserId,
      ),
    ).toBeNull();
  });

  test("continuing another user's conversation is refused", async () => {
    const started = await startExploreTurn(prisma, {
      conversationId: null,
      userId,
      question: "Which champion has the most games?",
    });

    await expect(
      startExploreTurn(prisma, {
        conversationId: started.conversationId,
        userId: otherUserId,
        question: "Sneaking in.",
      }),
    ).rejects.toThrow(/not found/i);
  });

  test("sharing is stable, readable without a user, and revocable", async () => {
    const started = await startExploreTurn(prisma, {
      conversationId: null,
      userId,
      question: "Which champion has the most games?",
    });
    await appendExploreAnswer(prisma, {
      conversationId: started.conversationId,
      ordinal: 1,
      answer: ANSWER,
      preview: null,
      visualization: null,
    });

    const token = await shareExploreConversation(
      prisma,
      started.conversationId,
      userId,
    );
    expect(token).toMatch(/^[0-9a-f]{32}$/);

    // Re-sharing keeps the link someone may already have been sent.
    expect(
      await shareExploreConversation(prisma, started.conversationId, userId),
    ).toBe(token);

    const shared = await loadSharedExploreTranscript(prisma, token ?? "");
    expect(shared?.messages).toHaveLength(2);
    expect(shared?.messages[1]?.content).toBe(ANSWER.answer);

    expect(
      await revokeExploreShare(prisma, started.conversationId, userId),
    ).toBe(true);
    expect(await loadSharedExploreTranscript(prisma, token ?? "")).toBeNull();
  });

  test("deleting a conversation removes its messages", async () => {
    const started = await startExploreTurn(prisma, {
      conversationId: null,
      userId,
      question: "Which champion has the most games?",
    });
    await appendExploreAnswer(prisma, {
      conversationId: started.conversationId,
      ordinal: 1,
      answer: ANSWER,
      preview: null,
      visualization: null,
    });

    expect(
      await deleteExploreConversation(prisma, started.conversationId, userId),
    ).toBe(true);
    expect(await prisma.exploreMessage.count()).toBe(0);
  });

  test("a long question is truncated into a usable title", () => {
    const title = titleFromQuestion(`  ${"a".repeat(400)}  `);
    expect(title).toHaveLength(120);
    expect(title.endsWith("…")).toBe(true);
  });
});
