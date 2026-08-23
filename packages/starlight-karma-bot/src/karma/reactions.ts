/** React-to-give: the lowest-friction way to award karma.
 *
 *  Giving previously required deliberately typing a slash command, and 28 of
 *  45 members had never done it. A reaction is one tap.
 *
 *  Requires `GatewayIntentBits.GuildMessageReactions` plus the Message and
 *  Reaction partials — reactions on messages older than the client's cache
 *  arrive partial and must be fetched. The intent is NOT privileged; only
 *  reading message *text* (`MessageContent`, which a `@user ++` syntax would
 *  need) is. */
import {
  bold,
  type Message,
  type MessageReaction,
  type PartialMessage,
  type PartialMessageReaction,
  type PartialUser,
  userMention,
  type User,
} from "discord.js";
import * as Sentry from "@sentry/bun";
import { karmaEmoji } from "#src/config.ts";
import { KARMA_GIVE_AMOUNT } from "#src/karma/scoring.ts";
import { ReactionOperationQueue } from "#src/karma/reaction-operation-queue.ts";
import {
  decideReactionAward,
  emojiMatchesKarma,
  shouldResolveReactionAdd,
} from "#src/karma/rules.ts";
import {
  recordKarma,
  revokeMessageReactionKarma,
  revokeReactionKarma,
} from "#src/karma/store.ts";

const reactionOperations = new ReactionOperationQueue();

function reactionOperationKey(
  reaction: MessageReaction | PartialMessageReaction,
): string {
  return reaction.message.id;
}

/** Resolve the partials an *add* event may arrive with. Returns null when the
 *  reaction is not a karma reaction or cannot be resolved. */
async function resolveAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<MessageReaction | null> {
  // The event payload always carries the emoji, even for a partial reaction.
  // Reject ordinary and bot reactions before a REST fetch and before they
  // enter the rest of the karma path.
  if (
    !shouldResolveReactionAdd({
      emoji: reaction.emoji,
      configuredEmoji: await karmaEmoji(reaction.message.guildId),
      reactorIsBot: user.bot,
    })
  ) {
    return null;
  }
  const full = reaction.partial ? await reaction.fetch() : reaction;
  if (full.message.partial) {
    await full.message.fetch();
  }
  return full;
}

async function applyReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  const full = await resolveAdd(reaction, user);
  if (full === null) {
    return;
  }

  const { guildId } = full.message;
  const decision = decideReactionAward({
    emojiMatches: true,
    guildId,
    reactorId: user.id,
    reactorIsBot: user.bot,
    authorId: full.message.author?.id,
    authorIsBot: full.message.author?.bot ?? false,
  });

  if (decision.action === "ignore") {
    console.warn(`[Karma Reaction] Ignoring reaction: ${decision.reason}`);
    return;
  }
  if (guildId === null) {
    // Unreachable — the decision above rejects DMs — but narrowing here keeps
    // the guild id non-null without an assertion.
    return;
  }

  console.warn(
    `[Karma Reaction] ${user.id} awarding karma to ${decision.receiverId} via message ${full.message.id}`,
  );
  const totals = await recordKarma({
    giverId: user.id,
    receiverId: decision.receiverId,
    amount: KARMA_GIVE_AMOUNT,
    guildId,
    sourceMessageId: full.message.id,
  });

  // Reactions are the primary giving surface, so a milestone reached this way
  // must be announced like any other — otherwise the celebration only ever
  // fires for the paths people use least.
  const { milestone } = totals;
  if (milestone !== null && full.message.channel.isSendable()) {
    await full.message.channel.send({
      content: `🎉 ${userMention(decision.receiverId)} just passed ${bold(milestone.toString())} karma!`,
    });
  }
}

export async function handleReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  await reactionOperations.run(reactionOperationKey(reaction), () =>
    applyReactionAdd(reaction, user),
  );
}

async function applyReactionRemove(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  // Deliberately does NOT call `reaction.fetch()`. Removing the last instance
  // of an emoji leaves nothing on the message for discord.js to resolve, so a
  // refetch throws and the award would silently survive the un-react. The
  // event payload already carries the emoji and the message id, which is
  // everything the revoke needs.
  if (
    !emojiMatchesKarma(
      reaction.emoji,
      await karmaEmoji(reaction.message.guildId),
    )
  ) {
    return;
  }

  const removed = await revokeReactionKarma(user.id, reaction.message.id);
  if (removed > 0) {
    console.warn(
      `[Karma Reaction] ${user.id} revoked ${removed.toString()} karma award(s) on message ${reaction.message.id}`,
    );
  }
}

export async function handleReactionRemove(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  await reactionOperations.run(reactionOperationKey(reaction), () =>
    applyReactionRemove(reaction, user),
  );
}

async function revokeMessageAwards(
  sourceMessageId: string,
  event: string,
): Promise<void> {
  const removed = await revokeMessageReactionKarma(sourceMessageId);
  if (removed > 0) {
    console.warn(
      `[Karma Reaction] ${event} revoked ${removed.toString()} karma award(s) on message ${sourceMessageId}`,
    );
  }
}

export async function handleReactionRemoveEmoji(
  reaction: MessageReaction | PartialMessageReaction,
): Promise<void> {
  if (
    !emojiMatchesKarma(
      reaction.emoji,
      await karmaEmoji(reaction.message.guildId),
    )
  ) {
    return;
  }
  await reactionOperations.run(reactionOperationKey(reaction), () =>
    revokeMessageAwards(reaction.message.id, "emoji removal"),
  );
}

export async function handleReactionRemoveAll(
  message: Message | PartialMessage,
): Promise<void> {
  await reactionOperations.run(message.id, () =>
    revokeMessageAwards(message.id, "reaction clear"),
  );
}

/** Wrap a handler so a failure is reported rather than becoming an unhandled
 *  rejection. Unlike an interaction there is no surface to reply on, so the
 *  only outcome is a log plus Sentry. */
export function guarded<A extends unknown[]>(
  name: string,
  handler: (...args: A) => Promise<void>,
): (...args: A) => void {
  return (...args: A) => {
    void (async () => {
      try {
        await handler(...args);
      } catch (error) {
        console.error("[Karma Reaction] handler failed:", name, error);
        Sentry.captureException(error, { tags: { source: name } });
      }
    })();
  };
}
