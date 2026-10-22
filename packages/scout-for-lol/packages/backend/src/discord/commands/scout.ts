import {
  DiscordGuildIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/domain/identity/discord.ts";
import {
  type Interaction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  MessageFlags,
} from "discord.js";
import {
  DiscordAccountIdSchema,
  type DiscordAccountId,
  EXPLORE_QUESTION_MAX_LENGTH,
  ExploreQuestionSchema,
  type ExploreAttachPoint,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { isExploreGuildAllowed } from "#src/explore/access.ts";
import { resolveExploreModel } from "#src/config/dynamic.ts";
import { tryStartExploreTurn } from "#src/explore/rate-limit.ts";
import type { runPersistedExploreTurn } from "#src/explore/runs/run-turn.ts";
import { runDurableDiscordExploreTurn } from "#src/explore/runs/discord/turn.ts";
import { ExploreRunRateLimitedError } from "#src/explore/runs/run-manager.ts";
import { loadExploreTranscript, startExploreTurn } from "#src/explore/store.ts";
import { rollbackUnstartedExploreTurn } from "#src/explore/rollback.ts";
import {
  exploreActionRow,
  exploreAnswerChunks,
  exploreCreationConfirmRows,
  MAX_MESSAGE_ROWS,
  exploreFollowUpRow,
  NO_GENERATED_MENTIONS,
} from "#src/discord/scout/messages.ts";
import { parseScoutFollowUpCustomId } from "#src/discord/scout/custom-id.ts";
import { exploreAnswerAttachments } from "#src/discord/scout/cards.ts";
import { scoutExploreTurnsTotal } from "#src/metrics/explore.ts";
import {
  claimExploreAttachments,
  discardExploreAttachment,
} from "#src/explore/attachments/storage.ts";
import {
  ASK_IMAGE_REFUSAL,
  acceptableAskImage,
  storeAskImage,
  type ScoutAskImage,
} from "#src/discord/scout/ask-image.ts";

export type ScoutAskInteraction = {
  guildId: Interaction["guildId"];
  user: { id: string; username: string; avatar: string | null };
  options: {
    getSubcommand: () => string;
    getString: (name: string, required: true) => string;
    getAttachment: (name: string) => ScoutAskImage | null;
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
  runTurn: async (input) => await runDurableDiscordExploreTurn(input),
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
  const guildId = DiscordGuildIdSchema.parse(interaction.guildId);
  if (!isExploreGuildAllowed(guildId)) {
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

  const image = interaction.options.getAttachment("image");
  if (image !== null && !acceptableAskImage(image)) {
    await interaction.reply({
      content: ASK_IMAGE_REFUSAL,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const attachmentIds: string[] = [];
  if (image !== null) {
    const stored = await storeAskImage(
      dependencies.client,
      DiscordAccountIdSchema.parse(interaction.user.id),
      image,
    );
    if (stored.kind === "refused") {
      await interaction.editReply({ content: stored.message });
      return;
    }
    attachmentIds.push(stored.id);
  }
  await answerOnDiscord({
    interaction,
    guildId,
    question: question.data,
    conversationId: null,
    attach: { kind: "leaf" },
    attachmentIds,
    dependencies,
  });
}

/** What every Discord-originated turn needs from its interaction. */
type DiscordTurnInteraction = Pick<
  ScoutAskInteraction,
  "user" | "editReply" | "followUp"
>;

/**
 * Ask Explore one question on Discord and deliver the answer privately.
 *
 * Shared by `/scout ask` (a new conversation) and the follow-up buttons under
 * an answer (the same conversation, branching from that answer), so both
 * apply the same rate limit, run the same durable turn and render the same
 * reply. The interaction must already be deferred.
 */
async function answerOnDiscord(input: {
  interaction: DiscordTurnInteraction;
  guildId: DiscordGuildId;
  question: string;
  conversationId: string | null;
  attach: ExploreAttachPoint;
  /** Images already stored for this question; a follow-up carries none. */
  attachmentIds?: readonly string[];
  dependencies: ScoutCommandDependencies;
}): Promise<void> {
  const { interaction, dependencies } = input;
  const identity = {
    userId: DiscordAccountIdSchema.parse(interaction.user.id),
  };
  const ticket = tryStartExploreTurn(identity, Date.now());
  if (!ticket.allowed) {
    scoutExploreTurnsTotal.inc({ status: "rate_limited" });
    await discardUnsentImages(
      dependencies.client,
      identity.userId,
      input.attachmentIds,
    );
    await interaction.editReply({ content: ticket.reason });
    return;
  }

  let runnerOwnsMetrics = false;
  let created: Awaited<ReturnType<typeof startExploreTurn>> | undefined;
  try {
    const conversationId =
      input.conversationId ?? globalThis.crypto.randomUUID();
    if (!ticket.claimConversation(conversationId)) {
      if (input.conversationId === null) {
        throw new Error("New Explore conversation id is already active.");
      }
      ticket.finish();
      await interaction.editReply({
        content:
          "Scout is still answering in this conversation. Try again when it finishes.",
      });
      return;
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
    created = await startExploreTurn(dependencies.client, {
      conversationId: input.conversationId,
      newId: conversationId,
      userId: identity.userId,
      question: input.question,
      attach: input.attach,
      origin: "discord",
    });
    // Just stored by this command for this user, so a refused claim is a
    // broken contract rather than a stale client.
    if (
      !(await claimExploreAttachments(dependencies.client, {
        ids: input.attachmentIds ?? [],
        ownerId: identity.userId,
        questionId: created.messageId,
      }))
    ) {
      throw new Error("A just-stored /scout ask image could not be claimed.");
    }
    const started = {
      ...created,
      question: input.question,
      model: resolveExploreModel(),
    };
    const transcript = await loadExploreTranscript(
      dependencies.client,
      started.conversationId,
      identity.userId,
      started.messageId,
    );
    if (transcript === null) {
      throw new Error("Explore conversation could not be loaded.");
    }

    runnerOwnsMetrics = true;
    const terminal = await dependencies.runTurn({
      ticket,
      identity,
      // Discord turns always carry a guild context (global in production,
      // guild-scoped in beta), so the invoking server is the whole alias scope.
      guildIds: [input.guildId],
      surface: "discord",
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
    await failAsk(error, {
      interaction,
      client: dependencies.client,
      userId: identity.userId,
      created,
      attachmentIds: input.attachmentIds,
      countError: !runnerOwnsMetrics,
    });
  }
}

/**
 * Finish an ask that threw: undo what it saved, then answer a refusal or
 * rethrow anything else.
 */
async function failAsk(
  error: unknown,
  context: {
    interaction: DiscordTurnInteraction;
    client: ExtendedPrismaClient;
    userId: DiscordAccountId;
    created: Awaited<ReturnType<typeof startExploreTurn>> | undefined;
    attachmentIds: readonly string[] | undefined;
    /** False once the runner has counted the turn itself. */
    countError: boolean;
  },
): Promise<void> {
  const refused = error instanceof ExploreRunRateLimitedError;
  if (!refused && context.countError) {
    scoutExploreTurnsTotal.inc({ status: "error" });
  }
  try {
    await undoUnstartedAsk(context.client, context.userId, {
      // Refused after the question was saved and selected: take it back, so
      // an unanswered question does not become the current branch and hide
      // an answer still running elsewhere. Other failures roll back where
      // they happen.
      created: refused ? context.created : undefined,
      attachmentIds: context.attachmentIds,
    });
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      "Scout ask failed, and undoing its question failed too",
      { cause: cleanupError },
    );
  }
  if (!refused) throw error;
  await context.interaction.editReply({ content: error.rejection.reason });
}

/**
 * Undo an ask that did not start: roll back its saved question when given,
 * then free its images' upload slots. A failed start returns images to the
 * unsent pool, and unlike the web composer nothing here sends them again.
 */
async function undoUnstartedAsk(
  client: ExtendedPrismaClient,
  userId: DiscordAccountId,
  input: {
    created: Awaited<ReturnType<typeof startExploreTurn>> | undefined;
    attachmentIds: readonly string[] | undefined;
  },
): Promise<void> {
  const { created } = input;
  if (created !== undefined)
    await rollbackUnstartedExploreTurn(client, {
      conversationId: created.conversationId,
      messageId: created.messageId,
      userId,
      previousCurrentLeafId: created.previousCurrentLeafId,
      createdConversation: created.createdConversation,
      createdQuestion: created.createdQuestion,
    });
  await discardUnsentImages(client, userId, input.attachmentIds);
}

/**
 * Free the upload slots of images stored for a question that was not asked.
 * An image the question already took is not unsent, so it is left alone.
 */
async function discardUnsentImages(
  client: ExtendedPrismaClient,
  ownerId: DiscordAccountId,
  ids: readonly string[] | undefined,
): Promise<void> {
  for (const id of ids ?? [])
    await discardExploreAttachment(client, ownerId, id);
}

export type ScoutFollowUpInteraction = DiscordTurnInteraction & {
  customId: string;
  guildId: Interaction["guildId"];
  deferReply: ScoutAskInteraction["deferReply"];
};

/**
 * A follow-up button under a Discord answer: ask that suggestion next.
 *
 * The text is read back from the saved answer, which also proves the clicker
 * owns the conversation — `loadExploreTranscript` is scoped to its owner.
 */
export async function executeScoutFollowUp(
  interaction: ScoutFollowUpInteraction,
  dependencies: ScoutCommandDependencies = defaultDependencies,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const parsed = parseScoutFollowUpCustomId(interaction.customId);
  if (parsed === undefined) {
    await interaction.editReply({
      content: "That Scout action is no longer valid.",
    });
    return;
  }
  if (interaction.guildId === null) {
    await interaction.editReply({
      content: "Scout Explore only works inside an enabled server.",
    });
    return;
  }
  const guildId = DiscordGuildIdSchema.parse(interaction.guildId);
  if (!isExploreGuildAllowed(guildId)) {
    await interaction.editReply({
      content: "Scout Explore is not enabled in this server.",
    });
    return;
  }
  const transcript = await loadExploreTranscript(
    dependencies.client,
    parsed.conversationId,
    DiscordAccountIdSchema.parse(interaction.user.id),
    parsed.assistantMessageId,
  );
  const answer = transcript?.messages.at(-1);
  const question =
    answer?.id === parsed.assistantMessageId && answer.role === "assistant"
      ? answer.followUps[parsed.index]
      : undefined;
  if (question === undefined) {
    await interaction.editReply({
      content: "That saved Scout answer could not be found for your account.",
    });
    return;
  }
  await answerOnDiscord({
    interaction,
    guildId,
    question,
    conversationId: parsed.conversationId,
    attach: { kind: "message", messageId: parsed.assistantMessageId },
    dependencies,
  });
}

async function sendPrivateAnswer(
  interaction: DiscordTurnInteraction,
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
  const visualization = exploreAnswerAttachments(answer);
  const followUps = exploreFollowUpRow({ conversationId, answer });
  const [firstConfirmations, ...moreConfirmations] =
    exploreCreationConfirmRows(answer);
  await interaction.editReply({
    content: first,
    components: [
      ...(firstConfirmations === undefined ? [] : [firstConfirmations]),
      exploreActionRow({
        conversationId,
        assistantMessageId: answer.id,
        posted: false,
      }),
      ...(followUps === null ? [] : [followUps]),
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
  for (
    let start = 0;
    start < moreConfirmations.length;
    start += MAX_MESSAGE_ROWS
  ) {
    await interaction.followUp({
      content: "More confirmations from this answer:",
      components: moreConfirmations.slice(start, start + MAX_MESSAGE_ROWS),
      flags: MessageFlags.Ephemeral,
      allowedMentions: NO_GENERATED_MENTIONS,
    });
  }
}
