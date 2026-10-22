import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  ConfirmationIntentPayloadSchema,
  DiscordGuildIdSchema,
  ExploreMessageSchema,
  type ExploreTraceEntry,
} from "@scout-for-lol/data";
import {
  creationIntentReplayContext,
  loadCreationIntentStates,
} from "#src/explore/creation/intent-replay.ts";
import { buildMessages } from "#src/explore/agent.ts";
import { createConfirmationIntent } from "#src/lib/confirmation-intent/create.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId } from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("explore-intent-replay-test");
const ASKER = testAccountId("61");
const GUILD = DiscordGuildIdSchema.parse("100000000000000061");
const NOW = new Date("2026-10-18T12:20:00.000Z");

async function mint(
  title: string,
  state: "pending" | "expired" | "confirmed" | "refused",
): Promise<ExploreTraceEntry> {
  const payload = ConfirmationIntentPayloadSchema.parse({
    kind: "report",
    guildId: GUILD,
    title,
    description: null,
    channelId: "200000000000000061",
    queryText:
      "SELECT player, COUNT(*) AS games FROM match_participants GROUP BY player RENDER table",
    cronExpression: "0 12 * * 0",
    scheduleTimezone: "UTC",
    isEnabled: true,
  });
  const expiresAt =
    state === "pending"
      ? new Date(NOW.getTime() + 60_000)
      : new Date(NOW.getTime() - 60_000);
  const created = await createConfirmationIntent(prisma, {
    serverId: GUILD,
    actorDiscordId: ASKER,
    payload,
    idempotencyKey: `${title}-${state}`,
    expiresAt,
  });
  if (created.kind !== "intent_created") throw new Error("not minted");
  if (state === "confirmed" || state === "refused") {
    await prisma.confirmationIntent.update({
      where: { id: created.intent.id },
      data: {
        consumedAt: new Date(NOW.getTime() - 120_000),
        resultJson: JSON.stringify(
          state === "confirmed"
            ? {
                kind: "created",
                entity: "report",
                entityId: 17,
                guildId: GUILD,
              }
            : {
                kind: "limit_reached",
                message: "You already have 2/2 active reports.",
              },
        ),
      },
    });
  }
  const value = {
    kind: "creation_confirmation_required",
    message: "Nothing has been created yet.",
    intent: {
      intentId: created.intent.id,
      kind: "report",
      guildId: GUILD,
      expiresAt: expiresAt.toISOString(),
      summary: `Report "${title}"`,
    },
  };
  return {
    toolCallId: `call-${title}`,
    toolName: "prepare_report_creation",
    message: "Prepared",
    status: "succeeded",
    durationMs: 1,
    details: null,
    rawInput: null,
    rawOutput: { kind: "value", value, byteLength: 10 },
  };
}

function assistantTurn(trace: ExploreTraceEntry[]) {
  return ExploreMessageSchema.parse({
    id: globalThis.crypto.randomUUID(),
    role: "assistant",
    content: "Nothing has been created yet; confirm the card.",
    trace,
    createdAt: NOW.toISOString(),
  });
}

beforeEach(async () => {
  await prisma.confirmationIntent.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("confirmation cards in replayed history", () => {
  test("each card replays its current state", async () => {
    const trace = [
      await mint("Weekly", "confirmed"),
      await mint("Daily", "expired"),
      await mint("Monthly", "pending"),
      await mint("Hourly", "refused"),
    ];
    const history = [assistantTurn(trace)];
    const states = await loadCreationIntentStates(prisma, history, NOW);
    const context = creationIntentReplayContext(trace, states);

    expect(context).toContain('Report "Weekly" — CONFIRMED');
    expect(context).toContain("the report now exists (id 17)");
    expect(context).toContain('Report "Daily" — expired unconfirmed');
    expect(context).toContain('Report "Monthly" — still waiting');
    expect(context).toContain(
      'Report "Hourly" — confirmation was refused at 2026-10-18T12:18:00.000Z: You already have 2/2 active reports.',
    );
  });

  test("the model sees a confirmation that happened after its answer", async () => {
    const history = [assistantTurn([await mint("Weekly", "confirmed")])];
    const states = await loadCreationIntentStates(prisma, history, NOW);
    const messages = buildMessages(
      {
        runId: "run",
        conversationId: "00000000-0000-4000-8000-000000000061",
        subject: { kind: "discord_user", id: ASKER },
        question: "Confirm",
        history,
        guildIds: [GUILD],
        requesterId: ASKER,
        originChannelId: null,
        surface: "web",
        abortSignal: new AbortController().signal,
        emit: () => Promise.resolve(),
      },
      states,
    );
    expect(messages[0]?.content).toContain("CONFIRMED");
    expect(messages.at(-1)).toEqual({ role: "user", content: "Confirm" });
  });

  test("a turn with no cards replays nothing extra", () => {
    expect(creationIntentReplayContext([], new Map())).toBe("");
  });
});
