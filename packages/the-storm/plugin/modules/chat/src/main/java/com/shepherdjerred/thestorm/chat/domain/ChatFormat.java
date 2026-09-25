package com.shepherdjerred.thestorm.chat.domain;

import java.util.List;
import java.util.Map;

/** Builds the MiniMessage for a chat line: trusted format and prefix, escaped player text. */
public final class ChatFormat {

  /** The placeholders a channel format uses. */
  public static final List<String> CHANNEL_PLACEHOLDERS = List.of("prefix", "player", "message");

  /** The placeholders the format for relayed (Discord) messages uses. */
  public static final List<String> EXTERNAL_PLACEHOLDERS = List.of("source", "author", "message");

  private ChatFormat() {}

  /** A channel format from config; it must use every channel placeholder. */
  public static LineTemplate channelTemplate(String source) {
    return new LineTemplate(source, CHANNEL_PLACEHOLDERS);
  }

  /** The relayed-message format from config; it must use every external placeholder. */
  public static LineTemplate externalTemplate(String source) {
    return new LineTemplate(source, EXTERNAL_PLACEHOLDERS);
  }

  /**
   * A player's line.
   *
   * @param prefix trusted MiniMessage from the prefix provider; followed by a space when present
   * @param player the player's name, escaped here
   * @param message the cleaned message, escaped here
   */
  public static String channelLine(
      LineTemplate template, String prefix, String player, String message) {
    return template.render(
        Map.of(
            "prefix", prefix.isEmpty() ? "" : prefix + " ",
            "player", MiniMessageText.escape(player),
            "message", MiniMessageText.escape(message)));
  }

  /** A relayed line; every value is untrusted and escaped here. */
  public static String externalLine(
      LineTemplate template, String source, String author, String message) {
    return template.render(
        Map.of(
            "source", MiniMessageText.escape(source),
            "author", MiniMessageText.escape(author),
            "message", MiniMessageText.escape(message)));
  }
}
