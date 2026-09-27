package com.shepherdjerred.thestorm.discord.domain;

/** Plain text crossing the Discord/Minecraft boundary. No markup is interpreted. */
public final class BridgeText {

  private static final int MAX_CONTENT = 300;

  private BridgeText() {}

  /** Removes control characters and Discord mass mentions, then bounds a chat line. */
  public static String clean(String input) {
    var normalized = input.replaceAll("[\\p{Cc}\\p{Cf}]", " ").trim();
    normalized = normalized.replace("@everyone", "@ everyone").replace("@here", "@ here");
    if (normalized.length() > MAX_CONTENT) {
      return normalized.substring(0, MAX_CONTENT - 1) + "…";
    }
    return normalized;
  }

  public static String fromMinecraft(String name, String message) {
    return "<" + clean(name) + "> " + clean(message);
  }

  public static String fromDiscord(String name, String message) {
    return "[Discord] <" + clean(name) + "> " + clean(message);
  }
}
