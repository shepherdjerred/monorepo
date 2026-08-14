/**
 * The explore HTTP surface, exercised through the real route handler.
 *
 * Two properties are worth pinning here rather than at the store layer:
 * the turn endpoint refuses an unauthenticated or non-allowlisted caller
 * before any model call, and the shared-transcript endpoint serves a frozen
 * conversation to an anonymous caller — it is the one route in this file that
 * is meant to work with no session at all.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";

const trpc = await createOfflineTrpcHarness("explore-http-e2e");
const { handleExploreRoute } = await import("#src/explore/http-route.ts");

const allowedGuild = DiscordGuildIdSchema.parse("100000000000009401");
const otherGuild = DiscordGuildIdSchema.parse("100000000000009402");
const owner = DiscordAccountIdSchema.parse("900000000000009401");
const cors: Record<string, string> = {};

const ErrorBody = z.object({ error: z.string() });

function setAllowlist(value: string | undefined): void {
  if (value === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = value;
  }
  resetConfigurationForTests();
}

async function postTurn(headers: Record<string, string>): Promise<Response> {
  const response = await handleExploreRoute(
    new Request("http://localhost/api/explore/stream", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ conversationId: null, question: "Who wins?" }),
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
        "SELECT champion, win_rate FROM match_participants GROUP BY champion",
      caveats: JSON.stringify(["Small sample."]),
      followUps: JSON.stringify(["How about by patch?"]),
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
  test("a turn without a session is rejected before any model call", async () => {
    const response = await postTurn({});
    expect(response.status).toBe(401);
    const body = ErrorBody.parse(await response.json());
    expect(body.error).toMatch(/sign in/i);
  });

  test("a non-POST turn request is rejected", async () => {
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

    const body = z
      .object({
        conversation: z.object({ title: z.string() }),
        messages: z.array(z.object({ content: z.string() })),
      })
      .parse(await response.json());
    expect(body.conversation.title).toBe("Champion win rates");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1]?.content).toBe("Jinx, over 42 games.");
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
    // No session either, so this asserts the ordering: authentication first.
    const response = await postTurn({});
    expect(response.status).toBe(401);
  });
});
