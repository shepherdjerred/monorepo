import type {
  InteractionEditReplyOptions,
  InteractionReplyOptions,
} from "discord.js";
import { MessageFlags } from "discord.js";
import {
  DiscordAccountIdSchema,
  EXPLORE_QUESTION_MAX_LENGTH,
  ExploreQuestionSchema,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { isExploreGuildAllowed } from "#src/explore/access.ts";
import { tryStartExploreTurn } from "#src/explore/rate-limit.ts";
import { runPersistedExploreTurn } from "#src/explore/run-turn.ts";
import { loadExploreTranscript, startExploreTurn } from "#src/explore/store.ts";
import {
  exploreActionRow,
  exploreAnswerChunks,
  NO_GENERATED_MENTIONS,
} from "#src/discord/scout/messages.ts";
import { exploreVisualizationPayload } from "#src/discord/scout/visualization.ts";
import { scoutExploreTurnsTotal } from "#src/metrics/explore.ts";

export type ScoutAskInteraction = {
  guildId: string | null;
  user: { id: string; username: string; avatar: string | null };
  options: {
    getSubcommand: () => string;
    getString: (name: string, required: true) => string;
  };
  deferReply: (options: { flags: MessageFlags.Ephemeral }) => Promise<unknown>;
  reply: (options: InteractionReplyOptions) => Promise<unknown>;
  editReply: (options: InteractionEditReplyOptions) => Promise<unknown>;
  followUp: (options: InteractionReplyOptions) => Promise<unknown>;
};

type ScoutCommandDependencies = {
  client: ExtendedPrismaClient;
  runTurn: typeof runPersistedExploreTurn;
};

const defaultDependencies: ScoutCommandDependencies = {
  client: prisma,
  runTurn: runPersistedExploreTurn,
};

export async function executeScout(
  interaction: ScoutAskInteraction,
  dependencies: ScoutCommandDependencies = defaultDependencies,
): Promise<void> {
  if (interaction.options.getSubcommand() !== "ask") {
    await interaction.reply({
      content: "That Scout action is not supported.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.guildId === null) {
    await interaction.reply({
      content: "Scout Explore only works inside an enabled server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!isExploreGuildAllowed(interaction.guildId)) {
    await interaction.reply({
      content: "Scout Explore is not enabled in this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const question = ExploreQuestionSchema.safeParse(
    interaction.options.getString("question", true),
  );
  if (!question.success) {
    await interaction.reply({
      content: `Questions must be between 1 and ${EXPLORE_QUESTION_MAX_LENGTH.toString()} characters.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const identity = {
    userId: DiscordAccountIdSchema.parse(interaction.user.id),
  };
  const ticket = tryStartExploreTurn(identity, Date.now());
  if (!ticket.allowed) {
    scoutExploreTurnsTotal.inc({ status: "rate_limited" });
    await interaction.editReply({ content: ticket.reason });
    return;
  }

  let runnerOwnsMetrics = false;
  try {
    const conversationId = globalThis.crypto.randomUUID();
    if (!ticket.claimConversation(conversationId)) {
      throw new Error("New Explore conversation id is already active.");
    }
    await dependencies.client.user.upsert({
      where: { discordId: identity.userId },
      create: {
        discordId: identity.userId,
        discordUsername: interaction.user.username,
        discordAvatar: interaction.user.avatar,
      },
      // OAuth credentials are deliberately omitted. A Discord command may
      // refresh profile display fields, but it never owns web-session tokens.
      update: {
        discordUsername: interaction.user.username,
        discordAvatar: interaction.user.avatar,
      },
    });
    const created = await startExploreTurn(dependencies.client, {
      conversationId: null,
      newId: conversationId,
      userId: identity.userId,
      question: question.data,
      attach: { kind: "leaf" },
    });
    const started = { ...created, question: question.data };
    const transcript = await loadExploreTranscript(
      dependencies.client,
      started.conversationId,
      identity.userId,
      started.messageId,
    );
    if (transcript === null) {
      throw new Error("New Explore conversation could not be loaded.");
    }

    runnerOwnsMetrics = true;
    const terminal = await dependencies.runTurn({
      ticket,
      identity,
      // The command is registered per guild and re-checks this exact guild, so
      // the invoking server is the whole alias scope for a Discord ask.
      guildIds: [interaction.guildId],
      started,
      history: transcript.messages,
      emit: () => Promise.resolve(),
    });
    if (terminal.type === "error") {
      await interaction.editReply({
        content: `${terminal.message}\n\nYour question was saved in Explore, but Scout did not produce an answer.`,
        allowedMentions: NO_GENERATED_MENTIONS,
      });
      return;
    }
    await sendPrivateAnswer(
      interaction,
      started.conversationId,
      terminal.message,
    );
  } catch (error) {
    ticket.finish();
    if (!runnerOwnsMetrics) {
      scoutExploreTurnsTotal.inc({ status: "error" });
    }
    throw error;
  }
}

async function sendPrivateAnswer(
  interaction: ScoutAskInteraction,
  conversationId: string,
  answer: Extract<
    Awaited<ReturnType<typeof runPersistedExploreTurn>>,
    { type: "final" }
  >["message"],
): Promise<void> {
  const chunks = exploreAnswerChunks(answer);
  const first = chunks[0];
  if (first === undefined) {
    throw new Error("Saved Explore answer had no Discord content.");
  }
  const visualization = exploreVisualizationPayload(answer);
  await interaction.editReply({
    content: first,
    components: [
      exploreActionRow({
        conversationId,
        assistantMessageId: answer.id,
        posted: false,
      }),
    ],
    allowedMentions: NO_GENERATED_MENTIONS,
    ...visualization,
  });
  for (const content of chunks.slice(1)) {
    await interaction.followUp({
      content,
      flags: MessageFlags.Ephemeral,
      allowedMentions: NO_GENERATED_MENTIONS,
    });
  }
}
