import { DiscordGuildIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type {
  InteractionEditReplyOptions,
  InteractionReplyOptions,
} from "discord.js";
import configuration, {
  resetConfigurationForTests,
} from "#src/configuration.ts";
import type * as screenshots from "#src/support/screenshots.ts";
import { resetExploreRateLimitStateForTests } from "#src/explore/rate-limit.ts";
import { ExploreRunRateLimitedError } from "#src/explore/runs/run-manager.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId } from "#src/testing/test-ids.ts";
import { executeScout } from "#src/discord/commands/scout.ts";

// Only the object store and the Discord download are faked; storing,
// claiming and discarding run real SQL. Hoisted: the command's static imports
// load both modules.
const png = vi.hoisted(() =>
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6QAAAABJRU5ErkJggg==",
    "base64",
  ),
);
vi.mock("#src/storage/s3-client.ts", () => ({
  createS3Client: () => ({ send: () => Promise.resolve({}) }),
}));
vi.mock("#src/support/screenshots.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof screenshots>()),
  readDiscordImage: () => Promise.resolve(new Uint8Array(png)),
}));
type ScoutAskInteraction = Parameters<typeof executeScout>[0];

const { prisma } = createTestDatabase("discord-scout-images-test");
const userId = testAccountId("83");
const allowedGuild = DiscordGuildIdSchema.parse("100000000000000083");
const originalAllowlist = Bun.env["EXPLORE_GUILD_ALLOWLIST"];

beforeEach(async () => {
  resetExploreRateLimitStateForTests();
  Bun.env["EXPLORE_GUILD_ALLOWLIST"] = allowedGuild;
  resetConfigurationForTests();
  vi.spyOn(configuration, "supportBucketName", "get").mockReturnValue(
    "scout-test",
  );
  await prisma.exploreAttachment.deleteMany();
  await prisma.exploreMessage.deleteMany();
  await prisma.exploreConversation.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
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

function askWithImage() {
  const edits: InteractionEditReplyOptions[] = [];
  const interaction: ScoutAskInteraction = {
    guildId: allowedGuild,
    user: { id: userId, username: "asker", avatar: null },
    options: {
      getSubcommand: () => "ask",
      getString: () => "What went wrong?",
      getAttachment: () => ({
        name: "board.png",
        url: "https://cdn.discordapp.com/attachments/1/2/board.png",
        contentType: "image/png",
        size: png.byteLength,
      }),
    },
    deferReply: () => Promise.resolve(undefined),
    reply: (_options: InteractionReplyOptions) => Promise.resolve(undefined),
    editReply: (options) => {
      edits.push(options);
      return Promise.resolve(undefined);
    },
    followUp: () => Promise.resolve(undefined),
  };
  return { interaction, edits };
}

/** A failed start returns the question's images to the unsent pool. */
async function releaseImages(): Promise<void> {
  await prisma.exploreAttachment.updateMany({ data: { questionId: null } });
}

async function unsentImages(): Promise<number> {
  return await prisma.exploreAttachment.count({
    where: { ownerId: userId, questionId: null },
  });
}

describe("/scout ask images after a failed start", () => {
  test("a start that fails discards the images it stored", async () => {
    const ask = askWithImage();
    await expect(
      executeScout(ask.interaction, {
        client: prisma,
        runTurn: async () => {
          await releaseImages();
          throw new Error("Temporal unavailable");
        },
      }),
    ).rejects.toThrow("Temporal unavailable");
    expect(await unsentImages()).toBe(0);
  });

  test("a refused start discards its images and takes its question back", async () => {
    const ask = askWithImage();
    await executeScout(ask.interaction, {
      client: prisma,
      runTurn: async () => {
        await releaseImages();
        throw new ExploreRunRateLimitedError({
          allowed: false,
          quota: [],
          retryAfterSeconds: 30,
          reason: "Another answer is still running.",
        });
      },
    });
    expect(JSON.stringify(ask.edits)).toContain(
      "Another answer is still running.",
    );
    expect(await unsentImages()).toBe(0);
    expect(await prisma.exploreConversation.count()).toBe(0);
  });
});
