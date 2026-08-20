import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type {
  InteractionEditReplyOptions,
  InteractionReplyOptions,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { resetConfigurationForTests } from "#src/configuration.ts";
import {
  handleScoutPublishButton,
  resetScoutPublishStateForTests,
  type ScoutPublishButtonInteraction,
} from "#src/discord/scout/publish.ts";
import { formatScoutPublishCustomId } from "#src/discord/scout/custom-id.ts";
import { scoutTestVisualization } from "#src/discord/scout/test-fixtures.ts";
import { appendExploreAnswer, startExploreTurn } from "#src/explore/store.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId } from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("discord-scout-publish-test");
const ownerId = testAccountId("91");
const strangerId = testAccountId("92");
const allowedGuild = "100000000000000091";
const originalAllowlist = Bun.env["EXPLORE_GUILD_ALLOWLIST"];

beforeEach(async () => {
  resetScoutPublishStateForTests();
  Bun.env["EXPLORE_GUILD_ALLOWLIST"] = allowedGuild;
  resetConfigurationForTests();
  await prisma.exploreMessage.deleteMany();
  await prisma.exploreConversation.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.createMany({
    data: [
      { discordId: ownerId, discordUsername: "owner" },
      { discordId: strangerId, discordUsername: "stranger" },
    ],
  });
});

afterEach(() => {
  if (originalAllowlist === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = originalAllowlist;
  }
  resetConfigurationForTests();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function savedAnswer(answerText = "Ahri wins most often.") {
  const started = await startExploreTurn(prisma, {
    conversationId: null,
    userId: ownerId,
    question: "Who wins most often?",
    attach: { kind: "leaf" },
  });
  const answer = await appendExploreAnswer(prisma, {
    conversationId: started.conversationId,
    parentMessageId: started.messageId,
    answer: {
      answer: answerText,
      title: null,
      queryText: "SELECT secret_query FROM match_participants",
      caveats: ["Tracked matches only."],
      followUps: [],
    },
    preview: null,
    visualization: scoutTestVisualization,
    trace: [
      {
        toolCallId: "call-private",
        toolName: "run_report_query",
        message: "private trace",
        status: "succeeded",
        durationMs: 1,
        details: null,
        rawInput: null,
        rawOutput: null,
      },
    ],
  });
  return {
    conversationId: started.conversationId,
    assistantMessageId: answer.id,
  };
}

function fakeInteraction(input: {
  customId: string;
  userId?: string;
  guildId?: string | null;
  onFollowUp?: (options: InteractionReplyOptions) => Promise<unknown>;
}) {
  const calls: string[] = [];
  const followUps: InteractionReplyOptions[] = [];
  const edits: InteractionEditReplyOptions[] = [];
  let deletedMessages = 0;
  const interaction: ScoutPublishButtonInteraction = {
    customId: input.customId,
    guildId: input.guildId === undefined ? allowedGuild : input.guildId,
    user: { id: input.userId ?? ownerId, username: "owner" },
    deferUpdate: () => {
      calls.push("deferUpdate");
      return Promise.resolve(undefined);
    },
    followUp: async (options) => {
      calls.push("followUp");
      followUps.push(options);
      await input.onFollowUp?.(options);
      return {
        delete: () => {
          deletedMessages++;
          return Promise.resolve(undefined);
        },
      };
    },
    editReply: (options) => {
      calls.push("editReply");
      edits.push(options);
      return Promise.resolve(undefined);
    },
  };
  return {
    interaction,
    calls,
    followUps,
    edits,
    deletedMessages: () => deletedMessages,
  };
}

describe("Scout public publishing", () => {
  test("publishes only frozen public fields and disables the private button", async () => {
    const saved = await savedAnswer();
    const fake = fakeInteraction({
      customId: formatScoutPublishCustomId(saved),
    });

    await handleScoutPublishButton(fake.interaction, prisma);

    expect(fake.calls[0]).toBe("deferUpdate");
    const publicJson = JSON.stringify(fake.followUps);
    expect(publicJson).toContain("Who wins most often?");
    expect(publicJson).toContain("Ahri wins most often.");
    expect(publicJson).toContain("Tracked matches only.");
    expect(fake.followUps[0]).not.toHaveProperty("flags");
    expect(publicJson).toContain('"parse":[]');
    expect(publicJson).not.toContain("secret_query");
    expect(publicJson).not.toContain("private trace");
    expect(publicJson).not.toContain("/app/explore/");
    expect(fake.followUps[0]).toHaveProperty("embeds");
    expect(fake.followUps[0]).not.toHaveProperty("files");
    expect(publicJson).toContain("Win rates");
    expect(JSON.stringify(fake.edits)).toContain("Posted");
    expect(JSON.stringify(fake.edits)).toContain('"disabled":true');
  });

  test.each([
    { kind: "dm", guildId: null },
    { kind: "wrong guild", guildId: "100000000000000093" },
  ])("rejects a $kind click privately", async ({ guildId }) => {
    const saved = await savedAnswer();
    const fake = fakeInteraction({
      customId: formatScoutPublishCustomId(saved),
      guildId,
    });
    await handleScoutPublishButton(fake.interaction, prisma);
    expect(fake.calls).toEqual(["deferUpdate", "followUp"]);
    expect(fake.followUps[0]?.flags).toBe(MessageFlags.Ephemeral);
  });

  test("rejects malformed, stale, wrong-owner, and revoked clicks privately", async () => {
    const saved = await savedAnswer();
    const cases = [
      fakeInteraction({ customId: "scout:1:publish:broken" }),
      fakeInteraction({
        customId: formatScoutPublishCustomId({
          conversationId: saved.conversationId,
          assistantMessageId: "10000000-0000-4000-8000-000000000099",
        }),
      }),
      fakeInteraction({
        customId: formatScoutPublishCustomId(saved),
        userId: strangerId,
      }),
    ];
    for (const fake of cases) {
      await handleScoutPublishButton(fake.interaction, prisma);
      expect(fake.followUps[0]?.flags).toBe(MessageFlags.Ephemeral);
      expect(fake.edits).toHaveLength(0);
    }

    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = "";
    resetConfigurationForTests();
    const revoked = fakeInteraction({
      customId: formatScoutPublishCustomId(saved),
    });
    await handleScoutPublishButton(revoked.interaction, prisma);
    expect(revoked.followUps[0]?.flags).toBe(MessageFlags.Ephemeral);
  });

  test("guards concurrent clicks for the same frozen answer", async () => {
    const saved = await savedAnswer();
    const gate = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const first = fakeInteraction({
      customId: formatScoutPublishCustomId(saved),
      onFollowUp: (options) => {
        if (options.flags === undefined) {
          entered.resolve(undefined);
          return gate.promise;
        }
        return Promise.resolve(undefined);
      },
    });
    const firstRun = handleScoutPublishButton(first.interaction, prisma);
    await entered.promise;
    const second = fakeInteraction({
      customId: formatScoutPublishCustomId(saved),
    });

    await handleScoutPublishButton(second.interaction, prisma);
    expect(second.followUps[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(JSON.stringify(second.followUps[0])).toContain(
      "already being posted",
    );
    gate.resolve(undefined);
    await firstRun;
  });

  test("leaves a failed post retryable without changing the saved answer", async () => {
    const saved = await savedAnswer("Analysis ".repeat(400));
    let publicSends = 0;
    const failed = fakeInteraction({
      customId: formatScoutPublishCustomId(saved),
      onFollowUp: (options) => {
        if (options.flags === undefined) {
          publicSends++;
          if (publicSends === 2) {
            return Promise.reject(new Error("Discord send failed"));
          }
        }
        return Promise.resolve(undefined);
      },
    });

    await expect(
      handleScoutPublishButton(failed.interaction, prisma),
    ).rejects.toThrow("Discord send failed");
    expect(failed.edits).toHaveLength(0);
    expect(failed.deletedMessages()).toBe(1);

    const retry = fakeInteraction({
      customId: formatScoutPublishCustomId(saved),
    });
    await handleScoutPublishButton(retry.interaction, prisma);
    expect(retry.followUps.length).toBeGreaterThan(1);
    expect(JSON.stringify(retry.edits)).toContain("Posted");
    expect(await prisma.exploreMessage.count()).toBe(2);
  });
});
