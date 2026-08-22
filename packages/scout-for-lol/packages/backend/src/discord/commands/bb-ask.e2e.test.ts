import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  runBucksAskAgent,
  type BucksAskModelRunner,
} from "#src/betting/ask-agent.ts";
import { loadBucksAskAnalyticsDataset } from "#src/betting/ask-analytics.ts";
import type { BucksAskResultRow } from "#src/betting/ask-analytics-schema.ts";
import {
  resetBucksAskPublishClaimsForTests,
  type BucksAskPublicMessage,
} from "#src/betting/ask-publish.ts";
import {
  getBucksAskQuotaStatus,
  resetBucksAskRateLimitStateForTests,
} from "#src/betting/ask-rate-limit.ts";
import { executeBb } from "#src/discord/commands/bb.ts";
import type { BbCommandInteraction } from "#src/discord/commands/bb-interaction.ts";
import {
  replyBucksAsk,
  type BucksAskAgentRunner,
} from "#src/discord/commands/bb-ask.ts";
import {
  routeButton,
  type RoutableButtonInteraction,
} from "#src/discord/interactions.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("bb-ask-command-e2e");
const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");
const ASKER = bucksTestDiscordId(1);
const LOSER = bucksTestDiscordId(2);
const BOT_ID = "1311755320745394317";
const QUESTION = "Who lost the most betting on jerry?";
const SETTLED_AT = new Date("2026-02-03T12:00:00.000Z");

const CommandAnswerSchema = z.object({
  embeds: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        color: z.number(),
        fields: z.array(z.object({ name: z.string(), value: z.string() })),
      }),
    )
    .length(1),
  components: z
    .array(
      z.object({
        type: z.literal(1),
        components: z
          .array(
            z.object({
              type: z.literal(2),
              custom_id: z.string(),
              label: z.string(),
              style: z.number(),
              disabled: z.boolean().optional(),
            }),
          )
          .length(1),
      }),
    )
    .length(1),
  allowedMentions: z.object({ parse: z.array(z.string()).length(0) }),
});

beforeAll(async () => {
  const askerAccount = await db.bucksAccount.create({
    data: { serverId: SERVER, discordId: ASKER, balance: 120 },
  });
  const loserAccount = await db.bucksAccount.create({
    data: { serverId: SERVER, discordId: LOSER, balance: 75 },
  });
  const roster = bucksTestRoster().map((participant, index) =>
    index === 0 ? { ...participant, trackedAlias: "jerry" } : participant,
  );
  const pool = await db.bucksMatchPool.create({
    data: {
      matchId: "NA1_BB_ASK_E2E",
      serverId: SERVER,
      detectedAt: SETTLED_AT,
      peekAvailableAt: SETTLED_AT,
      closesAt: SETTLED_AT,
      roster: JSON.stringify({ participants: roster }),
      poolState: "settled",
      winningTeamId: 200,
      settledAt: SETTLED_AT,
      createdAt: SETTLED_AT,
    },
  });
  await db.bucksBet.createMany({
    data: [
      {
        poolId: pool.id,
        bucksAccountId: loserAccount.id,
        predictedTeamId: 100,
        subjectPuuid: bucksTestPuuid(0),
        stake: 25,
        betOutcome: "lost",
        payout: 0,
        settledAt: SETTLED_AT,
        createdAt: SETTLED_AT,
      },
      {
        poolId: pool.id,
        bucksAccountId: askerAccount.id,
        predictedTeamId: 200,
        subjectPuuid: bucksTestPuuid(0),
        stake: 10,
        betOutcome: "won",
        payout: 30,
        settledAt: SETTLED_AT,
        createdAt: SETTLED_AT,
      },
    ],
  });
  const winningBet = await db.bucksBet.findFirstOrThrow({
    where: {
      poolId: pool.id,
      bucksAccountId: askerAccount.id,
      betOutcome: "won",
    },
  });
  await db.bucksLedgerEntry.create({
    data: {
      bucksAccountId: askerAccount.id,
      delta: 30,
      balanceAfter: 120,
      kind: "bet_payout",
      matchId: pool.matchId,
      betId: winningBet.id,
      context: "{}",
      createdAt: SETTLED_AT,
    },
  });
});

afterEach(() => {
  resetBucksAskPublishClaimsForTests();
  resetBucksAskRateLimitStateForTests();
});

afterAll(async () => {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksAccount.deleteMany();
  await db.$disconnect();
});

describe("/bb ask local end-to-end", () => {
  test("answers privately from SQLite and publishes the immutable embed without pings", async () => {
    const command = fakeAskCommand();
    await executeBb(command.interaction, { runAskAgent });

    expect(command.calls).toEqual(["deferReply", "editReply"]);
    expect(command.deferReplies).toEqual([{ ephemeral: true }]);
    expect(command.serializedEdits).toHaveLength(1);
    const answer = CommandAnswerSchema.parse(
      JSON.parse(command.serializedEdits[0] ?? "null"),
    );
    const embed = answer.embeds[0];
    const button = answer.components[0]?.components[0];
    expect(embed?.title).toBe("Bryan Bucks analysis");
    expect(embed?.description).toContain(`<@${LOSER}> lost 25 BB`);
    expect(embed?.description).toContain("2 matched positions");
    expect(embed?.description).toContain("2026-02-03");
    expect(embed?.fields).toEqual([{ name: "Question", value: QUESTION }]);
    expect(button).toMatchObject({
      label: "Post publicly",
    });
    expect(button).not.toHaveProperty("disabled");
    if (embed === undefined || button === undefined) {
      throw new Error(
        "The command did not return its answer and publish button",
      );
    }

    const publish = fakePublishInteraction(button.custom_id, embed);
    await routeButton(publish.interaction);

    expect(publish.calls).toEqual(["deferUpdate", "sendPublic", "editReply"]);
    expect(publish.publicMessages).toHaveLength(1);
    expect(publish.publicMessages[0]).toEqual({
      content: `Asked by <@${ASKER}>`,
      embeds: [embed],
      allowedMentions: { parse: [] },
      nonce: "bb-ask-ephemeral-e2e",
      enforceNonce: true,
    });
    expect(publish.publicMessages[0]?.embeds[0]).toBe(embed);
    expect(publish.edits[0]?.components?.[0]?.components[0]).toMatchObject({
      custom_id: button.custom_id,
      disabled: true,
    });
  });

  test("keeps concurrency claimed until timed-out work actually settles", async () => {
    let releaseWork: (() => void) | undefined;
    let markSettled: (() => void) | undefined;
    const pendingWork = new Promise<void>((resolve) => {
      releaseWork = resolve;
    });
    const underlyingSettled = new Promise<void>((resolve) => {
      markSettled = resolve;
    });
    const runAgent: BucksAskAgentRunner = async ({ abortSignal }) => {
      try {
        await pendingWork;
        abortSignal.throwIfAborted();
        throw new Error("timed-out work unexpectedly continued");
      } finally {
        markSettled?.();
      }
    };
    const command = fakeAskCommand();

    await replyBucksAsk(command.interaction, SERVER, ASKER, {
      runAgent,
      timeoutMs: 5,
    });

    expect(command.serializedEdits.at(-1)).toContain("took too long");
    expect(
      getBucksAskQuotaStatus({ userId: ASKER, serverId: SERVER }),
    ).toMatchObject({ active: true, activeGlobalRuns: 1 });
    if (releaseWork === undefined) {
      throw new Error("analysis work did not start");
    }
    releaseWork();
    await underlyingSettled;
    await Bun.sleep(0);
    expect(
      getBucksAskQuotaStatus({ userId: ASKER, serverId: SERVER }),
    ).toMatchObject({ active: false, activeGlobalRuns: 0 });
  });
});

const deterministicModel: BucksAskModelRunner = async (request) => {
  expect(request.question).toBe(QUESTION);
  expect(request.model).toBe("gpt-5.6-luna");
  const overview = await request.toolbox.getDataset();
  expect(overview.positionCount).toBe(2);
  const result = await request.toolbox.queryBets({
    measures: ["net_bb", "position_count", "settled_position_count"],
    groupBy: ["bettor"],
    filters: { subjectAliases: ["jerry"] },
    sort: { measure: "net_bb", direction: "asc" },
  });
  const first = result.rows[0];
  const bettor = dimension(first, "bettor");
  const netBb = metric(first, "net_bb");
  const settled = metric(first, "settled_position_count");
  if (netBb >= 0) throw new Error("The test dataset has no losing bettor");
  if (
    result.coverage.earliestAt === null ||
    result.coverage.latestAt === null
  ) {
    throw new Error("The test dataset has no date coverage");
  }
  return {
    answer: `${bettor} lost ${Math.abs(netBb).toString()} BB across ${settled.toString()} settled position. Sample: ${result.coverage.matchedRecords.toString()} matched positions from ${result.coverage.earliestAt.slice(0, 10)} to ${result.coverage.latestAt.slice(0, 10)}. This attributes the result to bets framed around jerry, not literal causation.`,
    usage: { inputTokens: 100, outputTokens: 45 },
  };
};

const runAskAgent: BucksAskAgentRunner = async (params) =>
  await runBucksAskAgent(params, {
    loadDataset: async (serverId) =>
      await loadBucksAskAnalyticsDataset(serverId, db),
    runModel: deterministicModel,
  });

function fakeAskCommand() {
  const calls: string[] = [];
  const deferReplies: Parameters<
    ChatInputCommandInteraction["deferReply"]
  >[0][] = [];
  const serializedEdits: string[] = [];
  const interaction: BbCommandInteraction = {
    id: "bb-ask-command-e2e",
    guildId: SERVER,
    user: { id: ASKER },
    options: {
      getSubcommand: () => "ask",
      getString: () => QUESTION,
      getInteger: () => 10,
    },
    replied: false,
    deferred: false,
    reply: vi.fn((payload) => Promise.resolve(payload)),
    deferReply: vi.fn((payload) => {
      calls.push("deferReply");
      deferReplies.push(payload);
      return Promise.resolve(payload);
    }),
    editReply: vi.fn((payload) => {
      calls.push("editReply");
      serializedEdits.push(JSON.stringify(payload));
      return Promise.resolve(payload);
    }),
    followUp: vi.fn((payload) => Promise.resolve(payload)),
  };
  return { interaction, calls, deferReplies, serializedEdits };
}

function fakePublishInteraction(
  customId: string,
  embed: z.infer<typeof CommandAnswerSchema>["embeds"][number],
) {
  const calls: string[] = [];
  const publicMessages: BucksAskPublicMessage[] = [];
  const edits: Parameters<RoutableButtonInteraction["editReply"]>[0][] = [];
  const interaction: RoutableButtonInteraction = {
    customId,
    guildId: SERVER,
    user: { id: ASKER, username: "asker" },
    client: { user: { id: BOT_ID } },
    message: {
      id: "bb-ask-ephemeral-e2e",
      author: { id: BOT_ID },
      embeds: [{ toJSON: () => embed }],
    },
    deferred: false,
    replied: false,
    deferUpdate: vi.fn(() => {
      calls.push("deferUpdate");
      return Promise.resolve(undefined);
    }),
    deferReply: vi.fn(() => Promise.resolve(undefined)),
    reply: vi.fn((payload) => Promise.resolve(payload)),
    editReply: vi.fn((payload) => {
      calls.push("editReply");
      edits.push(payload);
      return Promise.resolve(payload);
    }),
    followUp: vi.fn(() =>
      Promise.resolve({ delete: () => Promise.resolve(undefined) }),
    ),
    sendPublic: vi.fn((message) => {
      calls.push("sendPublic");
      publicMessages.push(message);
      return Promise.resolve(message);
    }),
  };
  return { interaction, calls, publicMessages, edits };
}

function metric(row: BucksAskResultRow | undefined, name: string): number {
  const value = row?.metrics.find(
    (candidate) => candidate.name === name,
  )?.value;
  if (typeof value !== "number") {
    throw new TypeError(`Missing metric ${name}`);
  }
  return value;
}

function dimension(row: BucksAskResultRow | undefined, name: string): string {
  const found = row?.dimensions.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`Missing dimension ${name}`);
  return found.value;
}
