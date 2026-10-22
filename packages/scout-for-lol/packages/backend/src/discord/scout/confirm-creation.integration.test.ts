import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import type { InteractionEditReplyOptions } from "discord.js";
import {
  ConfirmationIntentPayloadSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

/**
 * The Discord Confirm button runs the same confirm path as the web card:
 * actor-bound, single-use, re-authorized now — with permissions from Scout's
 * bot, because a Discord clicker has no web session. The harness mocks the
 * database, the channel guard and the bot reads; it is told who owns the guild
 * and who is in it.
 */

const GUILD = testGuildId("520001");
const CHANNEL = testChannelId("520002");
const OWNER = testAccountId("920000001");
const STRANGER = testAccountId("920000002");

const trpc = await createOfflineTrpcHarness("discord-confirm-creation-test");
const db = trpc.prisma;
const { handleScoutCreateButton } =
  await import("#src/discord/scout/confirm-creation.ts");
const { formatScoutCreateCustomId } =
  await import("#src/discord/scout/custom-id.ts");

async function mintReport(actor: DiscordAccountId = OWNER): Promise<string> {
  const payload = ConfirmationIntentPayloadSchema.parse({
    kind: "report",
    guildId: GUILD,
    channelId: CHANNEL,
    title: "Weekly games",
    description: null,
    queryText:
      "SELECT player, COUNT(*) AS games FROM match_participants GROUP BY player RENDER table",
  });
  const intent = await db.confirmationIntent.create({
    data: {
      kind: "report",
      serverId: GUILD,
      actorDiscordId: actor,
      payload: JSON.stringify(payload),
      idempotencyKey: globalThis.crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return intent.id;
}

function click(intentId: string, user: string, guildId: string | null) {
  const replies: InteractionEditReplyOptions[] = [];
  return {
    replies,
    interaction: {
      customId: formatScoutCreateCustomId({ intentId }),
      guildId,
      user: { id: user },
      deferReply: () => Promise.resolve(undefined),
      editReply: (options: InteractionEditReplyOptions) => {
        replies.push(options);
        return Promise.resolve(undefined);
      },
    },
  };
}

beforeAll(async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
});

beforeEach(async () => {
  await db.confirmationIntent.deleteMany();
  await db.auditLog.deleteMany();
  await db.reportScheduleOutbox.deleteMany();
  await db.report.deleteMany();
  resetFlagOverrides("explore_creation_enabled");
  addFlagOverride("explore_creation_enabled", true, { server: GUILD });
  trpc.setGuildOwner(GUILD, OWNER);
  trpc.setGuildMembers(GUILD, [OWNER]);
});

afterEach(() => {
  resetFlagOverrides("explore_creation_enabled");
});

afterAll(async () => {
  await shutdownFeatureFlags();
  await db.$disconnect();
});

describe("the Discord Confirm button", () => {
  test("creates the report for its owner, with an audit row and a link", async () => {
    const pressed = click(await mintReport(), OWNER, GUILD);
    await handleScoutCreateButton(pressed.interaction);

    expect(await db.report.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
    expect(pressed.replies.at(-1)?.content).toContain("your report is created");
    expect(pressed.replies.at(-1)?.content).toContain(
      `/app/g/${GUILD}/reports`,
    );
  });

  test("works from a DM, taking the server from the intent", async () => {
    const pressed = click(await mintReport(), OWNER, null);
    await handleScoutCreateButton(pressed.interaction);
    expect(await db.report.count()).toBe(1);
  });

  test("someone else's press creates nothing", async () => {
    const pressed = click(await mintReport(), STRANGER, GUILD);
    await handleScoutCreateButton(pressed.interaction);
    expect(await db.report.count()).toBe(0);
    expect(pressed.replies.at(-1)?.content).toContain("not yours");
  });

  test("a second press replays the first answer and creates nothing more", async () => {
    const intentId = await mintReport();
    await handleScoutCreateButton(click(intentId, OWNER, GUILD).interaction);
    const again = click(intentId, OWNER, GUILD);
    await handleScoutCreateButton(again.interaction);
    expect(await db.report.count()).toBe(1);
    expect(again.replies.at(-1)?.content).toContain("your report is created");
  });
});
