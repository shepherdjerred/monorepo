package com.shepherdjerred.thestorm.discord.domain;

import com.shepherdjerred.thestorm.core.result.Result;

/** Decides whether a Discord message is relayed into the game, and as what. */
public final class InboundFilter {

  /** Discord's own limit on display names. */
  public static final int MAX_AUTHOR_LENGTH = 32;

  static final String ATTACHMENT = "[attachment]";

  private InboundFilter() {}

  /**
   * The message to show in game, or why it is skipped. Bots and webhooks (including this bridge)
   * are never relayed; text is flattened to one plain line and cut to {@code maxLength}; a message
   * with only attachments is shown as {@code [attachment]}.
   */
  public static Result<Relayed, Skip> accept(InboundMessage message, int maxLength) {
    if (message.automated()) {
      return Result.err(Skip.AUTOMATED);
    }
    var text = DiscordText.fromDiscord(message.content());
    if (message.attachments() > 0) {
      text = text.isEmpty() ? ATTACHMENT : text + " " + ATTACHMENT;
    }
    if (text.isEmpty()) {
      return Result.err(Skip.EMPTY);
    }
    var author = DiscordText.fromDiscord(message.author());
    if (author.isEmpty()) {
      return Result.err(Skip.NAMELESS);
    }
    return Result.ok(
        new Relayed(
            DiscordText.truncate(author, MAX_AUTHOR_LENGTH),
            DiscordText.truncate(text, maxLength)));
  }

  /**
   * A message to relay.
   *
   * @param author the plain author name
   * @param text the plain message
   */
  public record Relayed(String author, String text) {}

  /** Why a message is not relayed. */
  public enum Skip {
    /** A bot or webhook posted it. */
    AUTOMATED,
    /** Nothing is left once it is cleaned. */
    EMPTY,
    /** The author's name is empty once cleaned. */
    NAMELESS
  }
}
