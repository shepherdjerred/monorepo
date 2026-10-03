import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import {
  BUCKS_INT32_MAX,
  DareDeadlineSpecSchema,
  DareSqlCompilationSchema,
  DareTargetBindingSchema,
  DiscordChannelIdSchema,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { z } from "zod";
import { DARE_MAX_TEXT_LENGTH } from "#src/betting/constants.ts";
import { bucksInsufficient } from "#src/betting/copy.ts";
import { DARES_NOT_ENABLED } from "#src/betting/dares/presentation/dare-callout-content.ts";
import { dareDraftComponents } from "#src/betting/dares/presentation/dare-components.ts";
import { createDareConfirmationIntent } from "#src/betting/dares/lifecycle/dare-intent.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { getExploreConversationUrl } from "#src/discord/commands/links.ts";
import type { BbCommandInteraction } from "#src/discord/commands/bb/bb-interaction.ts";
import { isExploreGuildAllowed } from "#src/explore/access.ts";
import { tryStartExploreTurn } from "#src/explore/rate-limit.ts";
import type { runPersistedExploreTurn } from "#src/explore/runs/run-turn.ts";
import { runDurableDiscordExploreTurn } from "#src/explore/runs/discord/turn.ts";
import { ExploreRunRateLimitedError } from "#src/explore/runs/run-manager.ts";
import { loadExploreTranscript, startExploreTurn } from "#src/explore/store.ts";
import {
  exploreAnswerChunks,
  NO_GENERATED_MENTIONS,
} from "#src/discord/scout/messages.ts";
import {
  splitMessageIntoChunks,
  truncateEmbedFieldValue,
} from "#src/discord/utils/message.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("command-bb-dare");

/**
 * `/bb dare` — draft a Dare through a private, saved Explore conversation and
 * show the binding SQL with a single-use funding confirmation.
 *
 * The `/bb` dispatcher has already deferred ephemerally and checked
 * `betting_enabled`; this adds the narrower `bucks_dares_enabled` gate. No
 * money moves here: the debit happens when the challenger confirms, so the
 * early balance check below is a friendlier error only — the guarded debit
 * inside funding stays authoritative.
 */

const BUCKS_COLOR = 0x2e_cc_71;

export type BbDareExploreDependencies = {
  client?: ExtendedPrismaClient;
  runTurn?: typeof runPersistedExploreTurn;
  createIntent?: typeof createDareConfirmationIntent;
  isPolicyEnabled?: typeof isPolicyEnabled;
  isExploreGuildAllowed?: typeof isExploreGuildAllowed;
};

export type BbDareCommandDependencies = {
  isDaresPolicyEnabled?: typeof isPolicyEnabled;
  dareExplore?: BbDareExploreDependencies;
  /** Best-effort wallet read for the friendlier pre-authoring error. */
  loadDareBalance?: (
    serverId: DiscordGuildId,
    discordId: DiscordAccountId,
  ) => Promise<number | undefined>;
};

async function defaultLoadDareBalance(
  serverId: DiscordGuildId,
  discordId: DiscordAccountId,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<number | undefined> {
  const account = await prismaClient.bucksAccount.findUnique({
    where: { serverId_discordId: { serverId, discordId } },
    select: { balance: true },
  });
  return account?.balance;
}

const DareOptionsSchema = z.strictObject({
  dare: z.string().min(1).max(DARE_MAX_TEXT_LENGTH),
  amount: z.number().int().min(1).max(BUCKS_INT32_MAX),
});

function deadlineText(raw: string): string {
  const spec = DareDeadlineSpecSchema.parse(JSON.parse(raw));
  return spec.kind === "relative"
    ? `${spec.days.toString()} days after every target accepts`
    : `${new Date(spec.deadlineAt).toLocaleString("en-US", {
        timeZone: spec.timezone,
        timeZoneName: "short",
      })} (${spec.timezone})`;
}

function questionForDare(text: string, amount: number): string {
  return [
    "Create one private relational Dare draft from this exact request:",
    text,
    `Opening stake: ${amount.toString()} BB.`,
    "Preserve explicit same-game versus cross-game scope. Validate the contract, then save the draft. Do not prepare funding yet.",
  ].join("\n");
}

function contractFields(revision: {
  compiledPlan: string;
  originalText: string;
  targetsJson: string;
  deadlineSpecJson: string;
  openingStake: number;
}) {
  const targets = DareTargetBindingSchema.array().parse(
    JSON.parse(revision.targetsJson),
  );
  const compilation = DareSqlCompilationSchema.parse(
    JSON.parse(revision.compiledPlan),
  );
  return [
    {
      name: "Original wording",
      value: truncateEmbedFieldValue(revision.originalText),
    },
    {
      name: "Targets",
      value: targets.map((target) => target.alias).join(", "),
    },
    {
      name: "Bounds",
      value: `At most ${compilation.maxEligibleGames.toString()} eligible games · ${deadlineText(revision.deadlineSpecJson)}`,
    },
    {
      name: "Economics",
      value: `${revision.openingStake.toString()} BB debited when you confirm. Targets risk nothing and must all accept before it goes live.`,
    },
  ];
}

function noDraftComponents(conversationId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Revise in Explore")
        .setStyle(ButtonStyle.Link)
        .setURL(getExploreConversationUrl(conversationId)),
    ),
  ];
}

async function loadCreatedDraft(
  client: ExtendedPrismaClient,
  conversationId: string,
  challengerDiscordId: DiscordAccountId,
) {
  const dare = await client.bucksDare.findFirst({
    where: {
      originConversationId: conversationId,
      challengerDiscordId,
      dareState: "draft",
    },
    include: { revisions: { orderBy: { revision: "desc" }, take: 1 } },
    orderBy: { id: "desc" },
  });
  const revision = dare?.revisions[0];
  return dare === null || revision === undefined ? null : { dare, revision };
}

async function replyWithoutDraft(
  interaction: BbCommandInteraction,
  conversationId: string,
  terminal: Awaited<ReturnType<typeof runPersistedExploreTurn>>,
): Promise<void> {
  const answerChunks =
    terminal.type === "final"
      ? exploreAnswerChunks(terminal.message)
      : splitMessageIntoChunks(terminal.message);
  const first = answerChunks[0];
  if (first === undefined) {
    throw new Error("Saved Dare Explore turn had no Discord content.");
  }
  await interaction.editReply({
    content: first,
    components: noDraftComponents(conversationId),
    allowedMentions: NO_GENERATED_MENTIONS,
  });
  for (const content of answerChunks.slice(1)) {
    await interaction.followUp({
      content,
      flags: MessageFlags.Ephemeral,
      allowedMentions: NO_GENERATED_MENTIONS,
    });
  }
  await interaction.followUp({
    content:
      terminal.type === "final"
        ? "No draft was funded or made public. Continue in Explore to clarify it."
        : "The conversation was saved; continue in Explore to revise the request.",
    flags: MessageFlags.Ephemeral,
    allowedMentions: NO_GENERATED_MENTIONS,
  });
}

async function replyExploreFailure(
  error: unknown,
  interaction: BbCommandInteraction,
): Promise<void> {
  if (error instanceof ExploreRunRateLimitedError) {
    await interaction.editReply({ content: error.rejection.reason });
    return;
  }
  throw error;
}

async function draftDareInExplore(
  interaction: BbCommandInteraction,
  input: {
    serverId: DiscordGuildId;
    channelId: DiscordChannelId;
    challengerDiscordId: DiscordAccountId;
    text: string;
    amount: number;
  },
  dependencies: BbDareExploreDependencies,
): Promise<void> {
  const exploreAllowed =
    dependencies.isExploreGuildAllowed ?? isExploreGuildAllowed;
  if (!exploreAllowed(input.serverId)) {
    await interaction.editReply({
      content: "Scout Explore is not enabled in this server.",
    });
    return;
  }
  const client = dependencies.client ?? prisma;
  const runTurn = dependencies.runTurn ?? runDurableDiscordExploreTurn;
  const identity = { userId: input.challengerDiscordId };
  const ticket = tryStartExploreTurn(identity, Date.now());
  if (!ticket.allowed) {
    await interaction.editReply({ content: ticket.reason });
    return;
  }

  const conversationId = globalThis.crypto.randomUUID();
  let runnerOwnsTicket = false;
  try {
    if (!ticket.claimConversation(conversationId)) {
      throw new Error("New Dare Explore conversation is already active.");
    }
    await client.user.upsert({
      where: { discordId: input.challengerDiscordId },
      create: {
        discordId: input.challengerDiscordId,
        discordUsername: input.challengerDiscordId,
      },
      update: {},
    });
    const question = questionForDare(input.text, input.amount);
    const created = await startExploreTurn(client, {
      conversationId: null,
      newId: conversationId,
      userId: input.challengerDiscordId,
      question,
      attach: { kind: "leaf" },
    });
    const transcript = await loadExploreTranscript(
      client,
      conversationId,
      input.challengerDiscordId,
      created.messageId,
    );
    if (transcript === null) {
      throw new Error("Dare Explore conversation could not be loaded.");
    }
    runnerOwnsTicket = true;
    const terminal = await runTurn({
      ticket,
      identity,
      guildIds: [input.serverId],
      // `/bb dare` is a Discord command, and the user upserted above carries no
      // OAuth token — so no creation tools, for the same reason `/scout ask`
      // gets none.
      surface: "discord",
      originChannelId: input.channelId,
      started: { ...created, question },
      history: transcript.messages,
      emit: () => Promise.resolve(),
    });
    const draft = await loadCreatedDraft(
      client,
      conversationId,
      input.challengerDiscordId,
    );
    if (draft === null) {
      await replyWithoutDraft(interaction, conversationId, terminal);
      return;
    }
    const createIntent =
      dependencies.createIntent ?? createDareConfirmationIntent;
    const intent = await createIntent(
      {
        dareId: draft.dare.id,
        serverId: input.serverId,
        actorDiscordId: input.challengerDiscordId,
        expectedRevision: draft.dare.currentRevision,
        payload: { kind: "dare_fund" },
        idempotencyKey: `discord:${interaction.id}:fund`,
      },
      {
        prismaClient: client,
        isPolicyEnabled: dependencies.isPolicyEnabled ?? isPolicyEnabled,
      },
    );
    if (intent.kind !== "intent_created") {
      throw new Error(`Dare funding intent failed: ${intent.kind}`);
    }
    const queryInline = draft.revision.canonicalScoutQl.length <= 900;
    const embed = new EmbedBuilder()
      .setTitle("🎯 Confirm your Scout dare")
      .setColor(BUCKS_COLOR)
      .setDescription(truncateEmbedFieldValue(draft.revision.plainLanguage))
      .addFields(...contractFields(draft.revision), {
        name: "Binding standard SQL",
        value: queryInline
          ? `\`\`\`sql\n${draft.revision.canonicalScoutQl}\n\`\`\``
          : "Attached as `dare.sql`.",
      })
      .setFooter({
        text: `Draft #${draft.dare.id.toString()} · revision ${draft.dare.currentRevision.toString()} · confirmation expires in 10 minutes`,
      });
    await interaction.editReply({
      embeds: [embed],
      components: dareDraftComponents({
        intentId: intent.intentId,
        dareId: draft.dare.id,
        revision: draft.dare.currentRevision,
        conversationId,
      }),
      ...(queryInline
        ? {}
        : {
            files: [
              new AttachmentBuilder(
                Buffer.from(draft.revision.canonicalScoutQl, "utf8"),
                { name: "dare.sql" },
              ),
            ],
          }),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    ticket.finish();
    await replyExploreFailure(error, interaction);
  } finally {
    if (!runnerOwnsTicket) ticket.finish();
  }
}

export async function replyBbDare(
  interaction: BbCommandInteraction,
  serverId: DiscordGuildId,
  discordId: DiscordAccountId,
  dependencies: BbDareCommandDependencies = {},
): Promise<void> {
  const daresEnabled = await (
    dependencies.isDaresPolicyEnabled ?? isPolicyEnabled
  )("bucks_dares_enabled", { server: serverId });
  if (!daresEnabled) {
    await interaction.editReply({ content: DARES_NOT_ENABLED });
    return;
  }
  // Discord's option bounds already enforce these; re-validated anyway
  // because the option payload is boundary input, not a contract.
  const options = DareOptionsSchema.safeParse({
    dare: interaction.options.getString("dare", true),
    amount: interaction.options.getInteger("amount", true),
  });
  if (!options.success) {
    await interaction.editReply({
      content: `💱 A dare needs text up to ${DARE_MAX_TEXT_LENGTH.toString()} characters and a positive whole-BB amount.`,
    });
    return;
  }
  const { dare: text, amount } = options.data;
  if (interaction.channelId === null) {
    await interaction.editReply({
      content: "🏠 Run `/bb dare` in a server channel.",
    });
    return;
  }
  const channelId = DiscordChannelIdSchema.parse(interaction.channelId);

  // Best-effort early balance check for a friendlier error before the model
  // call; a missing wallet is fine (funding ensures one), and the guarded
  // debit at funding time stays authoritative.
  try {
    const balance = await (
      dependencies.loadDareBalance ?? defaultLoadDareBalance
    )(serverId, discordId);
    if (balance !== undefined && balance < amount) {
      await interaction.editReply({
        content: bucksInsufficient(balance, amount),
      });
      return;
    }
  } catch (error) {
    logger.warn(
      `⚠️ Skipping the early dare balance check for ${serverId}:`,
      error,
    );
  }

  await draftDareInExplore(
    interaction,
    { serverId, channelId, challengerDiscordId: discordId, text, amount },
    dependencies.dareExplore ?? {},
  );
}
