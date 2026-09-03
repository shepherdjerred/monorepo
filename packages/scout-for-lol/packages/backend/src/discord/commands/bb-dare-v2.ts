import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import {
  DareCompiledPlanV2Schema,
  DareDeadlineSpecV2Schema,
  DareSqlV3CompilationSchema,
  DareTargetBindingV2Schema,
  type DareCompiledPlanV2,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { dareV2DraftComponents } from "#src/betting/dare-components-v2.ts";
import { createDareV2ConfirmationIntent } from "#src/betting/dare-intent-v2.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { getExploreConversationUrl } from "#src/discord/commands/links.ts";
import type { BbCommandInteraction } from "#src/discord/commands/bb-interaction.ts";
import { isExploreGuildAllowed } from "#src/explore/access.ts";
import { tryStartExploreTurn } from "#src/explore/rate-limit.ts";
import { runPersistedExploreTurn } from "#src/explore/run-turn.ts";
import { loadExploreTranscript, startExploreTurn } from "#src/explore/store.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import {
  exploreAnswerChunks,
  NO_GENERATED_MENTIONS,
} from "#src/discord/scout/messages.ts";
import {
  splitMessageIntoChunks,
  truncateEmbedFieldValue,
} from "#src/discord/utils/message.ts";

const BUCKS_COLOR = 0x2e_cc_71;

export type BbDareV2Dependencies = {
  client?: ExtendedPrismaClient;
  runTurn?: typeof runPersistedExploreTurn;
  createIntent?: typeof createDareV2ConfirmationIntent;
  isPolicyEnabled?: typeof isPolicyEnabled;
  isExploreGuildAllowed?: typeof isExploreGuildAllowed;
};

function scopeText(plan: DareCompiledPlanV2): string {
  if (plan.gameSets.length === 1) {
    return "All conditions inside the single game set must hold in one qualifying game.";
  }
  return "Each game set may qualify in a different game; conditions inside one set stay bound to that same game.";
}

function relationshipText(plan: DareCompiledPlanV2) {
  return plan.gameSets
    .map((gameSet) => {
      const relation = gameSet.relationship.replaceAll("_", " ");
      return `${gameSet.name}: ${relation}`;
    })
    .join(" · ");
}

function deadlineText(raw: string): string {
  const spec = DareDeadlineSpecV2Schema.parse(JSON.parse(raw));
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
  compilerVersion: string;
  compiledPlan: string;
  originalText: string;
  targetsJson: string;
  deadlineSpecJson: string;
  openingStake: number;
}) {
  const targets = DareTargetBindingV2Schema.array().parse(
    JSON.parse(revision.targetsJson),
  );
  const common = [
    {
      name: "Original wording",
      value: truncateEmbedFieldValue(revision.originalText),
    },
    {
      name: "Targets",
      value: targets.map((target) => target.alias).join(", "),
    },
  ];
  if (revision.compilerVersion === "dare-sql-3") {
    const compilation = DareSqlV3CompilationSchema.parse(
      JSON.parse(revision.compiledPlan),
    );
    return [
      ...common,
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
  const plan = DareCompiledPlanV2Schema.parse(
    JSON.parse(revision.compiledPlan),
  );
  const queues = [
    ...new Set(plan.gameSets.flatMap((gameSet) => gameSet.queues)),
  ];
  return [
    ...common,
    { name: "Scope", value: scopeText(plan) },
    { name: "Participation", value: relationshipText(plan) },
    { name: "Queues", value: queues.join(", ") },
    {
      name: "Bounds",
      value: `At most ${plan.maxEligibleGames.toString()} eligible games · ${deadlineText(revision.deadlineSpecJson)}`,
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
  const dare = await client.bucksDareV2.findFirst({
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

export async function replyBbDareV2(
  interaction: BbCommandInteraction,
  input: {
    serverId: DiscordGuildId;
    channelId: DiscordChannelId;
    challengerDiscordId: DiscordAccountId;
    text: string;
    amount: number;
  },
  dependencies: BbDareV2Dependencies = {},
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
  const runTurn = dependencies.runTurn ?? runPersistedExploreTurn;
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
      throw new Error("New Dare v2 Explore conversation is already active.");
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
      throw new Error("Dare v2 Explore conversation could not be loaded.");
    }
    runnerOwnsTicket = true;
    const terminal = await runTurn({
      ticket,
      identity,
      guildIds: [input.serverId],
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
      dependencies.createIntent ?? createDareV2ConfirmationIntent;
    const intent = await createIntent(
      {
        dareId: draft.dare.id,
        serverId: input.serverId,
        actorDiscordId: input.challengerDiscordId,
        expectedRevision: draft.dare.currentRevision,
        payload: { action: "fund" },
        idempotencyKey: `discord:${interaction.id}:fund`,
      },
      {
        prismaClient: client,
        isPolicyEnabled: dependencies.isPolicyEnabled ?? isPolicyEnabled,
      },
    );
    if (intent.kind !== "intent_created") {
      throw new Error(`Dare v2 funding intent failed: ${intent.kind}`);
    }
    const sqlV3 = draft.revision.compilerVersion === "dare-sql-3";
    const queryInline = draft.revision.canonicalScoutQl.length <= 900;
    const embed = new EmbedBuilder()
      .setTitle("🎯 Confirm your Scout dare")
      .setColor(BUCKS_COLOR)
      .setDescription(truncateEmbedFieldValue(draft.revision.plainLanguage))
      .addFields(...contractFields(draft.revision), {
        name: sqlV3 ? "Binding standard SQL" : "Generated ScoutQL",
        value: queryInline
          ? `\`\`\`sql\n${draft.revision.canonicalScoutQl}\n\`\`\``
          : `Attached as \`${sqlV3 ? "dare.sql" : "dare.scoutql"}\`.`,
      })
      .setFooter({
        text: `Draft #${draft.dare.id.toString()} · revision ${draft.dare.currentRevision.toString()} · confirmation expires in 10 minutes`,
      });
    await interaction.editReply({
      embeds: [embed],
      components: dareV2DraftComponents({
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
                { name: sqlV3 ? "dare.sql" : "dare.scoutql" },
              ),
            ],
          }),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    ticket.finish();
    throw error;
  } finally {
    if (!runnerOwnsTicket) ticket.finish();
  }
}
