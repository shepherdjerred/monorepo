import { DiscordGuildIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { appendExploreAnswer, startExploreTurn } from "#src/explore/store.ts";
import { runDurableDiscordExploreTurn } from "#src/explore/runs/discord/turn.ts";
import { ExploreRunRateLimitedError } from "#src/explore/runs/run-manager.ts";
import { ExploreDurablePayloadSchema } from "#src/explore/runs/durable-payload.ts";
import type { ExploreRateLimitTicket } from "#src/explore/rate-limit.ts";

const { prisma } = createTestDatabase("discord-durable-turn");
const userId = DiscordAccountIdSchema.parse("100000000000000001");
beforeEach(async () => {
  await prisma.scoutInteractiveRun.deleteMany();
  await prisma.exploreConversation.deleteMany();
  await prisma.user.upsert({
    where: { discordId: userId },
    update: {},
    create: {
      discordId: userId,
      discordUsername: "durable-turn",
      discordAvatar: null,
    },
  });
});
afterAll(async () => {
  await prisma.$disconnect();
});

function ticket(): ExploreRateLimitTicket {
  return {
    allowed: true,
    runId: crypto.randomUUID(),
    claimConversation: () => true,
    commit: vi.fn(),
    finish: vi.fn(),
  };
}
async function input() {
  const question = "Who wins most often?";
  const created = await startExploreTurn(prisma, {
    userId,
    conversationId: null,
    question,
    attach: { kind: "leaf" },
    origin: "discord",
  });
  return {
    ticket: ticket(),
    identity: { userId },
    guildIds: [DiscordGuildIdSchema.parse("200000000000000002")],
    surface: "discord" as const,
    started: { ...created, question },
    history: [],
    emit: async () => {
      /* Discord waits for the persisted terminal result. */
    },
  };
}

test("Discord reserves a shared durable run before its worker produces the saved answer", async () => {
  const request = await input();
  const startRun = vi.fn(
    async ({ summary }: { summary: { runId: string } }) => {
      const row = await prisma.scoutInteractiveRun.findUniqueOrThrow({
        where: { id: summary.runId },
      });
      expect(row.state).toBe("PENDING");
      expect(
        ExploreDurablePayloadSchema.parse(JSON.parse(row.payload)),
      ).toMatchObject({
        surface: "discord",
        guildIds: request.guildIds,
        started: request.started,
      });
      const answer = await appendExploreAnswer(prisma, {
        conversationId: request.started.conversationId,
        parentMessageId: request.started.messageId,
        guildIds: request.guildIds,
        expectedCurrentLeafId: request.started.expectedCurrentLeafId,
        answer: {
          answer: "Ahri wins most often.",
          title: null,
          queryText: null,
          includeVisualization: false,
          caveats: [],
          followUps: [],
          matchCards: [],
          loadoutCards: [],
        },
        preview: null,
        visualization: null,
        trace: [],
      });
      await prisma.scoutInteractiveRun.update({
        where: { id: row.id },
        data: {
          state: "COMPLETED",
          outcome: "succeeded",
          resultMessageId: answer.id,
          completedAt: new Date(),
        },
      });
    },
  );
  const result = await runDurableDiscordExploreTurn(request, prisma, {
    startRun,
  });
  expect(result.type).toBe("final");
  if (result.type !== "final") throw new Error("No saved answer");
  expect(result.message.content).toBe("Ahri wins most often.");
  expect(startRun).toHaveBeenCalledTimes(1);
  expect(request.ticket.commit).toHaveBeenCalledTimes(1);
  expect(request.ticket.finish).toHaveBeenCalledTimes(1);
});

test("an ambiguous Temporal start leaves the run recoverable and blocks a second execution", async () => {
  const request = await input();
  const startRun = vi.fn(async () => {
    throw new Error("start response lost");
  });
  await expect(
    runDurableDiscordExploreTurn(request, prisma, { startRun }),
  ).rejects.toThrow("start response lost");
  expect(
    await prisma.scoutInteractiveRun.findUniqueOrThrow({
      where: { id: request.ticket.runId },
    }),
  ).toMatchObject({ state: "PENDING", outcome: null });
  const repeated = { ...request, ticket: ticket() };
  await expect(
    runDurableDiscordExploreTurn(repeated, prisma, { startRun }),
  ).rejects.toBeInstanceOf(ExploreRunRateLimitedError);
  expect(startRun).toHaveBeenCalledTimes(1);
  expect(await prisma.scoutInteractiveRun.count()).toBe(1);
  expect(repeated.ticket.finish).toHaveBeenCalledTimes(1);
});
