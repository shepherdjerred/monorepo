import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import type {
  InteractionEditReplyOptions,
  InteractionReplyOptions,
} from "discord.js";
import { MessageFlags } from "discord.js";
import type { ExploreAgentParams } from "#src/explore/agent.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import {
  executeScout,
  type ScoutAskInteraction,
} from "#src/discord/commands/scout.ts";
import { resetExploreRateLimitStateForTests } from "#src/explore/rate-limit.ts";
import { runPersistedExploreTurn } from "#src/explore/run-turn.ts";
import { scoutTestVisualization } from "#src/discord/scout/test-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId } from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("discord-scout-command-test");
const userId = testAccountId("81");
const allowedGuild = "100000000000000081";
const originalAllowlist = Bun.env["EXPLORE_GUILD_ALLOWLIST"];
const originalOrigin = Bun.env["WEB_APP_ORIGIN"];

beforeEach(async () => {
  resetExploreRateLimitStateForTests();
  Bun.env["EXPLORE_GUILD_ALLOWLIST"] = allowedGuild;
  Bun.env["WEB_APP_ORIGIN"] = "https://beta.scout-for-lol.com/";
  resetConfigurationForTests();
  await prisma.exploreMessage.deleteMany();
  await prisma.exploreConversation.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  if (originalAllowlist === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = originalAllowlist;
  }
  if (originalOrigin === undefined) {
    delete Bun.env["WEB_APP_ORIGIN"];
  } else {
    Bun.env["WEB_APP_ORIGIN"] = originalOrigin;
  }
  resetConfigurationForTests();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function fakeInteraction(input?: {
  guildId?: string | null;
  question?: string;
}) {
  const replies: InteractionReplyOptions[] = [];
  const edits: InteractionEditReplyOptions[] = [];
  const followUps: InteractionReplyOptions[] = [];
  let deferred = 0;
  const interaction: ScoutAskInteraction = {
    guildId: input?.guildId === undefined ? allowedGuild : input.guildId,
    user: { id: userId, username: "fresh-name", avatar: "fresh-avatar" },
    options: {
      getSubcommand: () => "ask",
      getString: () => input?.question ?? "Who wins most often?",
    },
    deferReply: () => {
      deferred++;
      return Promise.resolve(undefined);
    },
    reply: (options) => {
      replies.push(options);
      return Promise.resolve(undefined);
    },
    editReply: (options) => {
      edits.push(options);
      return Promise.resolve(undefined);
    },
    followUp: (options) => {
      followUps.push(options);
      return Promise.resolve(undefined);
    },
  };
  return { interaction, replies, edits, followUps, deferred: () => deferred };
}

const successfulAgent = async (_params: ExploreAgentParams) => ({
  answer: {
    answer: "Ahri wins most often.",
    title: "Most frequent winners",
    queryText: "SELECT champion, wins FROM match_participants",
    caveats: ["Tracked matches only."],
    followUps: [],
  },
  preview: null,
  visualization: scoutTestVisualization,
});

const interruptedAgent = async (params: ExploreAgentParams) => {
  await params.emit({ type: "answer_delta", text: "The sample suggests" });
  throw new Error("provider disconnected");
};

const throwingRun: typeof runPersistedExploreTurn = () =>
  Promise.reject(new Error("runner setup failed"));

const successfulRun: typeof runPersistedExploreTurn = async (input) =>
  await runPersistedExploreTurn(input, {
    client: prisma,
    executeAgent: successfulAgent,
    now: Date.now,
    timeoutMs: 10_000,
  });

describe("/scout ask", () => {
  test("rejects DMs, unallowlisted guilds, and invalid questions privately", async () => {
    for (const input of [
      { guildId: null, question: "Who wins?" },
      { guildId: "100000000000000082", question: "Who wins?" },
      { guildId: allowedGuild, question: " ".repeat(10) },
      { guildId: allowedGuild, question: "x".repeat(2001) },
    ]) {
      const fake = fakeInteraction(input);
      await executeScout(fake.interaction, {
        client: prisma,
        runTurn: successfulRun,
      });
      expect(fake.replies).toHaveLength(1);
      expect(fake.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
      expect(fake.deferred()).toBe(0);
    }
  });

  test("preserves OAuth tokens, saves a fresh answer, and returns private actions", async () => {
    await prisma.user.create({
      data: {
        discordId: userId,
        discordUsername: "old-name",
        discordAvatar: "old-avatar",
        discordAccessToken: "access-token",
        discordRefreshToken: "refresh-token",
        tokenExpiresAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    });
    const first = fakeInteraction();
    await executeScout(first.interaction, {
      client: prisma,
      runTurn: successfulRun,
    });
    const second = fakeInteraction({ question: "Who has the best KDA?" });
    await executeScout(second.interaction, {
      client: prisma,
      runTurn: successfulRun,
    });

    const user = await prisma.user.findUnique({ where: { discordId: userId } });
    expect(user).toEqual(
      expect.objectContaining({
        discordUsername: "fresh-name",
        discordAvatar: "fresh-avatar",
        discordAccessToken: "access-token",
        discordRefreshToken: "refresh-token",
      }),
    );
    expect(await prisma.exploreConversation.count({ where: { userId } })).toBe(
      2,
    );
    expect(await prisma.exploreMessage.count()).toBe(4);
    expect(first.deferred()).toBe(1);
    expect(first.edits).toHaveLength(1);
    const responseJson = JSON.stringify(first.edits[0]);
    expect(responseJson).toContain("Ahri wins most often.");
    expect(responseJson).toContain("Tracked matches only.");
    expect(responseJson).toContain("Open in Explore");
    expect(responseJson).toContain("Post publicly");
    expect(responseJson).toContain(
      "https://beta.scout-for-lol.com/app/explore/",
    );
    expect(responseJson).toContain('"parse":[]');
    expect(first.edits[0]).toHaveProperty("embeds");
    expect(first.edits[0]).not.toHaveProperty("files");
    expect(responseJson).toContain("Win rates");
    expect(responseJson).toContain("Aurora");
  });

  test("renders a salvaged partial answer as a publishable saved result", async () => {
    const interruptedRun: typeof runPersistedExploreTurn = async (input) =>
      await runPersistedExploreTurn(input, {
        client: prisma,
        executeAgent: interruptedAgent,
        now: Date.now,
        timeoutMs: 10_000,
      });
    const fake = fakeInteraction();

    await executeScout(fake.interaction, {
      client: prisma,
      runTurn: interruptedRun,
    });

    const responseJson = JSON.stringify(fake.edits[0]);
    expect(responseJson).toContain("The sample suggests");
    expect(responseJson).toContain("interrupted by an error");
    expect(responseJson).toContain("Post publicly");
  });

  test("releases the per-user slot when command setup fails", async () => {
    const failed = fakeInteraction();
    await expect(
      executeScout(failed.interaction, {
        client: prisma,
        runTurn: throwingRun,
      }),
    ).rejects.toThrow("runner setup failed");

    const retry = fakeInteraction({ question: "Can I retry now?" });
    await executeScout(retry.interaction, {
      client: prisma,
      runTurn: successfulRun,
    });
    expect(JSON.stringify(retry.edits)).toContain("Ahri wins most often.");
  });
});
