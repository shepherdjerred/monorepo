import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { DARE_MAX_TEXT_LENGTH } from "#src/dares/constants.ts";
import { createDareConfirmationIntent } from "#src/dares/lifecycle/dare-intent.ts";
import { DARES_NOT_ENABLED } from "#src/dares/presentation/dare-callout-content.ts";
import { dareDraftComponents } from "#src/dares/presentation/dare-components.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { DareCommandInteraction } from "#src/discord/commands/dare-interaction.ts";
import { getExploreConversationUrl } from "#src/discord/commands/links.ts";
import {
  exploreAnswerChunks,
  NO_GENERATED_MENTIONS,
} from "#src/discord/scout/messages.ts";
import {
  splitMessageIntoChunks,
  truncateEmbedFieldValue,
} from "#src/discord/utils/message.ts";
import { isExploreGuildAllowed } from "#src/explore/access.ts";
import { tryStartExploreTurn } from "#src/explore/rate-limit.ts";
import { runDurableDiscordExploreTurn } from "#src/explore/runs/discord/turn.ts";
import { ExploreRunRateLimitedError } from "#src/explore/runs/run-manager.ts";
import type { runPersistedExploreTurn } from "#src/explore/runs/run-turn.ts";
import { loadExploreTranscript, startExploreTurn } from "#src/explore/store.ts";
import {
  DareDeadlineSpecSchema,
  DareSqlCompilationSchema,
  DareTargetBindingSchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { z } from "zod";

/** Draft a free Dare in a private Explore conversation, then request confirmation. */

const DARE_COLOR = 0x2e_cc_71;

export type DareExploreDependencies = {
  client?: ExtendedPrismaClient;
  runTurn?: typeof runPersistedExploreTurn;
  createIntent?: typeof createDareConfirmationIntent;
  isPolicyEnabled?: typeof isPolicyEnabled;
  isExploreGuildAllowed?: typeof isExploreGuildAllowed;
};

export type DareCommandDependencies = {
  isDaresPolicyEnabled?: typeof isPolicyEnabled;
  dareExplore?: DareExploreDependencies;
};

const DareOptionsSchema = z.strictObject({
  dare: z.string().min(1).max(DARE_MAX_TEXT_LENGTH),
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

function questionForDare(text: string): string {
  return [
    "Create one private relational Dare draft from this exact request:",
    text,
    "Preserve explicit same-game versus cross-game scope. Validate the contract, then save the draft. Do not prepare publishing yet.",
  ].join("\n");
}

function contractFields(revision: {
  compiledPlan: string;
  originalText: string;
  targetsJson: string;
  deadlineSpecJson: string;
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
  const dare = await client.dare.findFirst({
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
  interaction: DareCommandInteraction,
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
        ? "No draft was published or made public. Continue in Explore to clarify it."
        : "The conversation was saved; continue in Explore to revise the request.",
    flags: MessageFlags.Ephemeral,
    allowedMentions: NO_GENERATED_MENTIONS,
  });
}

async function replyExploreFailure(
  error: unknown,
  interaction: DareCommandInteraction,
): Promise<void> {
  if (error instanceof ExploreRunRateLimitedError) {
    await interaction.editReply({ content: error.rejection.reason });
    return;
  }
  throw error;
}

async function draftDareInExplore(
  interaction: DareCommandInteraction,
  input: {
    serverId: DiscordGuildId;
    channelId: DiscordChannelId;
    challengerDiscordId: DiscordAccountId;
    text: string;
  },
  dependencies: DareExploreDependencies,
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
    const question = questionForDare(input.text);
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
      // `/dare` is a Discord command, and the user upserted above carries no
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
        payload: { kind: "dare_publish" },
        idempotencyKey: `discord:${interaction.id}:fund`,
      },
      {
        prismaClient: client,
        isPolicyEnabled: dependencies.isPolicyEnabled ?? isPolicyEnabled,
      },
    );
    if (intent.kind !== "intent_created") {
      throw new Error(`Dare publishing intent failed: ${intent.kind}`);
    }
    const queryInline = draft.revision.canonicalScoutQl.length <= 900;
    const embed = new EmbedBuilder()
      .setTitle("🎯 Confirm your Scout dare")
      .setColor(DARE_COLOR)
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

export async function replyDare(
  interaction: DareCommandInteraction,
  serverId: DiscordGuildId,
  discordId: DiscordAccountId,
  dependencies: DareCommandDependencies = {},
): Promise<void> {
  const daresEnabled = await (
    dependencies.isDaresPolicyEnabled ?? isPolicyEnabled
  )("dares_enabled", { server: serverId });
  if (!daresEnabled) {
    await interaction.editReply({ content: DARES_NOT_ENABLED });
    return;
  }
  // Discord's option bounds already enforce these; re-validated anyway
  // because the option payload is boundary input, not a contract.
  const options = DareOptionsSchema.safeParse({
    dare: interaction.options.getString("text", true),
  });
  if (!options.success) {
    await interaction.editReply({
      content: `💱 A dare needs text up to ${DARE_MAX_TEXT_LENGTH.toString()} characters characters.`,
    });
    return;
  }
  const { dare: text } = options.data;
  if (interaction.channelId === null) {
    await interaction.editReply({
      content: "🏠 Run `/dare` in a server channel.",
    });
    return;
  }
  const channelId = DiscordChannelIdSchema.parse(interaction.channelId);

  await draftDareInExplore(
    interaction,
    { serverId, channelId, challengerDiscordId: discordId, text },
    dependencies.dareExplore ?? {},
  );
}

export async function executeDare(
  interaction: DareCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (interaction.guildId === null) {
    await interaction.editReply({ content: "Run /dare in a server channel." });
    return;
  }
  await replyDare(
    interaction,
    DiscordGuildIdSchema.parse(interaction.guildId),
    DiscordAccountIdSchema.parse(interaction.user.id),
  );
}
