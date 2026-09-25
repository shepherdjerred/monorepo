package com.shepherdjerred.thestorm.chat.domain;

import java.util.List;
import java.util.Map;

/** Builds the MiniMessage for a chat line: trusted format and prefix, escaped player text. */
public final class ChatFormat {

  /** The placeholders a channel format uses. */
  public static final List<String> CHANNEL_PLACEHOLDERS = List.of("prefix", "player", "message");

  /** The placeholders the emote ({@code /me}) format uses. */
  public static final List<String> EMOTE_PLACEHOLDERS =
      List.of("channel", "prefix", "player", "message");

  /** The placeholders the private message format uses. */
  public static final List<String> PRIVATE_PLACEHOLDERS = List.of("from", "to", "message");

  /** The placeholders the format for relayed (Discord) messages uses. */
  public static final List<String> EXTERNAL_PLACEHOLDERS = List.of("source", "author", "message");

  private ChatFormat() {}

  /** A channel format from config; it must use every channel placeholder. */
  public static LineTemplate channelTemplate(String source) {
    return new LineTemplate(source, CHANNEL_PLACEHOLDERS);
  }

  /** The emote format from config; it must use every emote placeholder. */
  public static LineTemplate emoteTemplate(String source) {
    return new LineTemplate(source, EMOTE_PLACEHOLDERS);
  }

  /** The private message format from config; it must use every private placeholder. */
  public static LineTemplate privateTemplate(String source) {
    return new LineTemplate(source, PRIVATE_PLACEHOLDERS);
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
            "prefix", spaced(prefix),
            "player", MiniMessageText.escape(player),
            "message", MiniMessageText.escape(message)));
  }

  /** A {@code /me} line in {@code channel}; the player and action are escaped here. */
  public static String emoteLine(LineTemplate template, ChannelKey channel, Speech speech) {
    return template.render(
        Map.of(
            "channel", channel.tag(),
            "prefix", spaced(speech.prefix()),
            "player", MiniMessageText.escape(speech.player()),
            "message", MiniMessageText.escape(speech.message())));
  }

  /** A private message line, shown the same to sender and recipient; all values are escaped. */
  public static String privateLine(LineTemplate template, String from, String to, String message) {
    return template.render(
        Map.of(
            "from", MiniMessageText.escape(from),
            "to", MiniMessageText.escape(to),
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

  private static String spaced(String prefix) {
    return prefix.isEmpty() ? "" : prefix + " ";
  }

  /**
   * What a player said, for formats with a prefix.
   *
   * @param prefix trusted MiniMessage, or empty
   * @param player the player's name, untrusted
   * @param message the cleaned message, untrusted
   */
  public record Speech(String prefix, String player, String message) {}
}
