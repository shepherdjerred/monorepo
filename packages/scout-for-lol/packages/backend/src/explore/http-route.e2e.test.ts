/**
 * The explore HTTP surface, exercised through the real route handler.
 *
 * Two properties are worth pinning here rather than at the store layer:
 * the turn endpoint refuses an unauthenticated or non-allowlisted caller
 * before any model call, and the shared-transcript endpoint serves a frozen
 * conversation to an anonymous caller — it is the one route in this file that
 * is meant to work with no session at all.
 */

import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  EXPLORE_INTERRUPTED_CAVEAT,
  EXPLORE_STOPPED_CAVEAT,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";

const trpc = await createOfflineTrpcHarness("explore-http-e2e");
const { handleExploreRoute } = await import("#src/explore/http-route.ts");
const { persistPartialAnswer } = await import("#src/explore/partial-answer.ts");
const { appendExploreAnswer } = await import("#src/explore/store.ts");

const allowedGuild = DiscordGuildIdSchema.parse("100000000000009401");
const otherGuild = DiscordGuildIdSchema.parse("100000000000009402");
const owner = DiscordAccountIdSchema.parse("900000000000009401");
const cors: Record<string, string> = {};

const ErrorBody = z.object({ error: z.string() });

const { signSession } = await import("#src/trpc/jwt.ts");
/** Headers for a request that passes session + CSRF + origin. */
async function authedHeaders(): Promise<Record<string, string>> {
  const { jwt } = await signSession({ discordId: owner });
  return {
    "content-type": "application/json",
    cookie: `scout_session=${jwt}; scout_csrf=csrf`,
    "x-csrf-token": "csrf",
    Origin: "https://scout-for-lol.com",
  };
}

function setAllowlist(value: string | undefined): void {
  if (value === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = value;
  }
  resetConfigurationForTests();
}

async function postObserver(
  headers: Record<string, string>,
): Promise<Response> {
  const response = await handleExploreRoute(
    new Request("http://localhost/api/explore/stream", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        runId: "00000000-0000-4000-8000-000000000001",
      }),
    }),
    new URL("http://localhost/api/explore/stream"),
    cors,
  );
  if (response === null) {
    throw new Error("expected the explore route to handle this request");
  }
  return response;
}

async function getShared(token: string): Promise<Response> {
  const url = new URL(`http://localhost/api/explore/shared/${token}`);
  const response = await handleExploreRoute(
    new Request(url.toString(), { method: "GET" }),
    url,
    cors,
  );
  if (response === null) {
    throw new Error("expected the explore route to handle this request");
  }
  return response;
}

beforeEach(async () => {
  await trpc.prisma.exploreMessage.deleteMany();
  await trpc.prisma.exploreConversation.deleteMany();
  await trpc.prisma.user.upsert({
    where: { discordId: owner },
    create: { discordId: owner, discordUsername: "owner" },
    update: {},
  });
  trpc.setMembership([{ guildId: allowedGuild, asAdmin: false }]);
  setAllowlist(allowedGuild);
});

afterAll(async () => {
  setAllowlist(undefined);
  await trpc.prisma.$disconnect();
});

async function seedSharedConversation(): Promise<string> {
  const shareToken = "a".repeat(32);
  const conversation = await trpc.prisma.exploreConversation.create({
    data: {
      userId: owner,
      title: "Champion win rates",
      shareToken,
      sharedAt: new Date(),
    },
  });
  const question = await trpc.prisma.exploreMessage.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: "Which champion wins most?",
    },
  });
  const answer = await trpc.prisma.exploreMessage.create({
    data: {
      conversationId: conversation.id,
      parentId: question.id,
      role: "assistant",
      content: "Jinx, over 42 games.",
      queryText:
        "SELECT champion, win_rate FROM match_participants GROUP BY champion DURING LAST 30 DAYS",
      caveats: JSON.stringify(["Small sample."]),
      followUps: JSON.stringify(["How about by patch?"]),
      trace: JSON.stringify([
        {
          toolCallId: "call-1",
          toolName: "run_report_query",
          message: "Got results.",
          status: "succeeded",
          durationMs: 125,
          details: {
            kind: "execution",
            queryText: "FROM matches SELECT games",
            ok: true,
            rowsReturned: 1,
            rowsScanned: 42,
            renderKind: "TABLE",
          },
          rawInput: {
            kind: "value",
            value: { secret: "owner-only-input" },
            byteLength: 29,
          },
          rawOutput: {
            kind: "value",
            value: { secret: "owner-only-output" },
            byteLength: 30,
          },
        },
      ]),
    },
  });
  // A share pins the path it was taken from, so later branching cannot change
  // what the link renders.
  await trpc.prisma.exploreConversation.update({
    where: { id: conversation.id },
    data: { currentLeafId: answer.id, sharedLeafId: answer.id },
  });
  return shareToken;
}

/**
 * A shared link keeps showing the path it captured even after the owner adds a
 * different branch — the freeze guarantee the stored results already give,
 * extended to which turns are on screen.
 */
async function branchAfterShare(shareToken: string): Promise<void> {
  const conversation = await trpc.prisma.exploreConversation.findUniqueOrThrow({
    where: { shareToken },
    include: { messages: true },
  });
  const question = conversation.messages.find(
    (message) => message.role === "user",
  );
  if (question === undefined) {
    throw new Error("expected the seeded question");
  }
  const rival = await trpc.prisma.exploreMessage.create({
    data: {
      conversationId: conversation.id,
      parentId: question.id,
      role: "assistant",
      content: "On reflection, Caitlyn.",
    },
  });
  await trpc.prisma.exploreConversation.update({
    where: { id: conversation.id },
    data: { currentLeafId: rival.id },
  });
}

describe("explore http route", () => {
  test("an observer without a session is rejected", async () => {
    const response = await postObserver({});
    expect(response.status).toBe(401);
    const body = ErrorBody.parse(await response.json());
    expect(body.error).toMatch(/sign in/i);
  });

  test("an authenticated observer gets a safe 404 after a run finishes", async () => {
    const response = await postObserver(await authedHeaders());
    expect(response.status).toBe(404);
    const body = ErrorBody.parse(await response.json());
    expect(body.error).toMatch(/not found/i);
  });

  test("a non-POST observer request is rejected", async () => {
    const url = new URL("http://localhost/api/explore/stream");
    const response = await handleExploreRoute(
      new Request(url.toString(), { method: "GET" }),
      url,
      cors,
    );
    expect(response?.status).toBe(405);
  });

  test("an oversized body is rejected without being parsed", async () => {
    const url = new URL("http://localhost/api/explore/stream");
    const response = await handleExploreRoute(
      new Request(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: null,
          question: "x".repeat(20_000),
        }),
      }),
      url,
      cors,
    );
    expect(response?.status).toBe(413);
  });

  test("an oversized streamed body is refused without being buffered", async () => {
    // No Content-Length to check: a chunked body has none, and a client
    // controls the header anyway, so the read itself has to be what stops.
    const url = new URL("http://localhost/api/explore/stream");
    const chunk = new TextEncoder().encode("x".repeat(4096));
    let produced = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced >= 64) {
          controller.close();
          return;
        }
        produced += 1;
        controller.enqueue(chunk);
      },
    });

    const response = await handleExploreRoute(
      new Request(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        duplex: "half",
      }),
      url,
      cors,
    );

    expect(response?.status).toBe(413);
    // 16 KiB limit, 4 KiB chunks: the read stops rather than draining all 256 KiB.
    expect(produced).toBeLessThanOrEqual(8);
  });
});

/** Seed a conversation with just its opening question, returning both ids. */
async function seedQuestion(): Promise<{
  conversationId: string;
  questionId: string;
}> {
  const conversation = await trpc.prisma.exploreConversation.create({
    data: {
      userId: owner,
      title: "Champion win rates",
      messages: { create: { role: "user", content: "Which champion wins?" } },
    },
    include: { messages: true },
  });
  const question = conversation.messages[0];
  if (question === undefined) {
    throw new Error("expected the seeded question");
  }
  return { conversationId: conversation.id, questionId: question.id };
}

describe("explore salvage", () => {
  test("a stop before prose salvages nothing", async () => {
    const seeded = await seedQuestion();
    const salvaged = await persistPartialAnswer(trpc.prisma, {
      stopped: true,
      conversationId: seeded.conversationId,
      parentMessageId: seeded.questionId,
      expectedCurrentLeafId: null,
      text: "",
      trace: [],
      existingMessageId: null,
    });

    expect(salvaged).toBeNull();
    expect(await trpc.prisma.exploreMessage.count()).toBe(1);
  });

  test("a stopped turn with text is saved with the stop caveat", async () => {
    const seeded = await seedQuestion();
    const salvaged = await persistPartialAnswer(trpc.prisma, {
      stopped: true,
      conversationId: seeded.conversationId,
      parentMessageId: seeded.questionId,
      expectedCurrentLeafId: null,
      text: "Jinx is ahead so far…",
      trace: [],
      existingMessageId: null,
    });

    expect(salvaged?.parentId).toBe(seeded.questionId);
    expect(salvaged?.content).toBe("Jinx is ahead so far…");
    expect(salvaged?.caveats).toEqual([EXPLORE_STOPPED_CAVEAT]);
    expect(salvaged?.queryText).toBeNull();
    expect(salvaged?.preview).toBeNull();
    expect(salvaged?.visualization).toBeNull();
  });

  test("an errored turn with streamed text is saved with the interrupted caveat", async () => {
    const seeded = await seedQuestion();
    const salvaged = await persistPartialAnswer(trpc.prisma, {
      stopped: false,
      conversationId: seeded.conversationId,
      parentMessageId: seeded.questionId,
      expectedCurrentLeafId: null,
      text: "Jinx is ahead so far…",
      trace: [],
      existingMessageId: null,
    });

    expect(salvaged?.caveats).toEqual([EXPLORE_INTERRUPTED_CAVEAT]);
    // The salvage row is on the path — the reader lands on it, not a bare
    // question.
    const conversation = await trpc.prisma.exploreConversation.findUnique({
      where: { id: seeded.conversationId },
      select: { currentLeafId: true },
    });
    expect(conversation?.currentLeafId).toBe(salvaged?.id ?? "");
  });

  test("an errored turn with no text saves nothing", async () => {
    const seeded = await seedQuestion();
    const salvaged = await persistPartialAnswer(trpc.prisma, {
      stopped: false,
      conversationId: seeded.conversationId,
      parentMessageId: seeded.questionId,
      expectedCurrentLeafId: null,
      text: "   ",
      trace: [],
      existingMessageId: null,
    });

    expect(salvaged).toBeNull();
    expect(await trpc.prisma.exploreMessage.count()).toBe(1);
  });

  test("cancellation during persistence replaces the answer instead of adding a sibling", async () => {
    const seeded = await seedQuestion();
    const persisted = await appendExploreAnswer(trpc.prisma, {
      conversationId: seeded.conversationId,
      parentMessageId: seeded.questionId,
      answer: {
        answer: "A late complete answer",
        title: null,
        queryText: null,
        caveats: [],
        followUps: [],
      },
      preview: null,
      visualization: null,
      trace: [],
      expectedCurrentLeafId: null,
    });

    const salvaged = await persistPartialAnswer(trpc.prisma, {
      stopped: true,
      conversationId: seeded.conversationId,
      parentMessageId: seeded.questionId,
      expectedCurrentLeafId: null,
      text: "Partial answer",
      trace: [],
      existingMessageId: persisted.id,
    });

    expect(salvaged?.id).toBe(persisted.id);
    expect(salvaged?.content).toBe("Partial answer");
    expect(salvaged?.caveats).toEqual([EXPLORE_STOPPED_CAVEAT]);
    expect(await trpc.prisma.exploreMessage.count()).toBe(2);
  });

  test("cancellation during persistence removes an answer when no prose streamed", async () => {
    const seeded = await seedQuestion();
    const persisted = await appendExploreAnswer(trpc.prisma, {
      conversationId: seeded.conversationId,
      parentMessageId: seeded.questionId,
      answer: {
        answer: "A late complete answer",
        title: null,
        queryText: null,
        caveats: [],
        followUps: [],
      },
      preview: null,
      visualization: null,
      trace: [],
      expectedCurrentLeafId: null,
    });

    const salvaged = await persistPartialAnswer(trpc.prisma, {
      stopped: true,
      conversationId: seeded.conversationId,
      parentMessageId: seeded.questionId,
      expectedCurrentLeafId: null,
      text: "",
      trace: [],
      existingMessageId: persisted.id,
    });

    expect(salvaged).toBeNull();
    expect(await trpc.prisma.exploreMessage.count()).toBe(1);
    expect(
      await trpc.prisma.exploreConversation.findUnique({
        where: { id: seeded.conversationId },
        select: { currentLeafId: true },
      }),
    ).toEqual({ currentLeafId: null });
  });
});

describe("explore http route — remaining surface", () => {
  test("an oversized error message does not break the error response", async () => {
    // `parseRequestBody` runs before auth, and a wide invalid body makes Zod's
    // message grow without bound — while `ExploreHttpErrorSchema` caps it at
    // 1000. Unclamped, building the 400 would itself throw.
    const url = new URL("http://localhost/api/explore/stream");
    const response = await handleExploreRoute(
      new Request(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: 123,
          parentMessageId: 456,
          question: Array.from({ length: 60 }, (_, index) => index),
        }),
      }),
      url,
      cors,
    );

    expect(response?.status).toBe(400);
    const body = ErrorBody.parse(await response?.json());
    expect(body.error.length).toBeLessThanOrEqual(1000);
  });

  test("an unrelated path is not claimed by the explore handler", async () => {
    const url = new URL("http://localhost/api/something-else");
    expect(
      await handleExploreRoute(
        new Request(url.toString(), { method: "GET" }),
        url,
        cors,
      ),
    ).toBeNull();
  });

  test("a shared transcript is readable with no session and is never cached", async () => {
    const shareToken = await seedSharedConversation();

    const response = await getShared(shareToken);
    expect(response.status).toBe(200);
    // A cached copy would outlive a revoked share, so nothing may store it.
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const rawBody: unknown = await response.json();
    const body = z
      .object({
        conversation: z.object({ title: z.string() }),
        messages: z.array(
          z.object({
            content: z.string(),
            trace: z.array(
              z.object({
                details: z.object({ kind: z.string() }).nullable(),
                rawInput: z.null(),
                rawOutput: z.null(),
              }),
            ),
          }),
        ),
      })
      .parse(rawBody);
    expect(body.conversation.title).toBe("Champion win rates");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1]?.content).toBe("Jinx, over 42 games.");
    expect(body.messages[1]?.trace[0]?.details?.kind).toBe("execution");
    expect(JSON.stringify(rawBody)).not.toContain("owner-only");
  });

  test("an unknown or malformed share token is a 404", async () => {
    const unknown = await getShared("b".repeat(32));
    expect(unknown.status).toBe(404);
    const malformed = await getShared("not-a-token");
    expect(malformed.status).toBe(404);
  });

  test("a revoked share stops resolving", async () => {
    const shareToken = await seedSharedConversation();
    const before = await getShared(shareToken);
    expect(before.status).toBe(200);

    await trpc.prisma.exploreConversation.updateMany({
      where: { shareToken },
      data: { shareToken: null, sharedAt: null },
    });
    const after = await getShared(shareToken);
    expect(after.status).toBe(404);
  });

  test("a shared link keeps its path after the owner branches", async () => {
    const shareToken = await seedSharedConversation();
    await branchAfterShare(shareToken);

    const response = await getShared(shareToken);
    expect(response.status).toBe(200);
    const body = z
      .object({ messages: z.array(z.object({ content: z.string() })) })
      .parse(await response.json());
    expect(body.messages.map((message) => message.content)).toEqual([
      "Which champion wins most?",
      "Jinx, over 42 games.",
    ]);
  });

  test("membership outside the allowlist is refused", async () => {
    setAllowlist(otherGuild);
    const response = await postObserver(await authedHeaders());
    expect(response.status).toBe(403);
  });
});
