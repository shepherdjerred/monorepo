package com.shepherdjerred.thestorm.discord.domain;

import java.util.regex.Pattern;

/**
 * Text crossing the bridge. Game text going to Discord is cleaned, has its Discord markdown escaped
 * and its mentions neutralized; Discord text coming into the game is flattened to one plain line.
 */
public final class DiscordText {

  /** Discord's message length limit. */
  public static final int DISCORD_LIMIT = 2000;

  /** Stops {@code @everyone}, {@code @here} and name mentions from resolving. */
  static final String ZERO_WIDTH_SPACE = String.valueOf((char) 0x200B);

  private static final char SECTION_SIGN = (char) 0xA7;
  private static final String ESCAPED_ANYWHERE = "\\*_~`|<[]";
  private static final String ESCAPED_AT_START = "#->+";
  private static final Pattern ORDERED_LIST = Pattern.compile("^(\\d+)\\.");
  private static final Pattern CUSTOM_EMOJI = Pattern.compile("<a?:(\\w{2,32}):\\d+>");
  private static final Pattern MARKDOWN_MARKERS = Pattern.compile("\\*\\*|__|~~|\\|\\||`");
  private static final Pattern BACKSLASH_ESCAPE = Pattern.compile("\\\\(\\p{Punct})");

  private DiscordText() {}

  /**
   * Removes control and invisible characters and legacy {@code §} formatting codes, turns every run
   * of whitespace (including newlines) into one space and trims.
   */
  public static String clean(String raw) {
    var out = new StringBuilder(raw.length());
    var pendingSpace = false;
    for (var i = 0; i < raw.length(); i++) {
      var c = raw.charAt(i);
      if (c == SECTION_SIGN) {
        i++;
      } else if (Character.isWhitespace(c) || Character.isSpaceChar(c)) {
        pendingSpace = out.length() > 0;
      } else if (!Character.isISOControl(c) && Character.getType(c) != Character.FORMAT) {
        if (pendingSpace) {
          out.append(' ');
          pendingSpace = false;
        }
        out.append(c);
      }
    }
    return out.toString();
  }

  /**
   * Game text made safe to embed in a Discord message: cleaned, markdown escaped (Discord hides a
   * backslash before any punctuation), and every {@code @} followed by a zero-width space.
   */
  public static String forDiscord(String gameText) {
    var text = clean(gameText);
    var out = new StringBuilder(text.length() + 16);
    for (var i = 0; i < text.length(); i++) {
      var c = text.charAt(i);
      if (ESCAPED_ANYWHERE.indexOf(c) >= 0 || (i == 0 && ESCAPED_AT_START.indexOf(c) >= 0)) {
        out.append('\\').append(c);
      } else if (c == '@') {
        out.append(c).append(ZERO_WIDTH_SPACE);
      } else {
        out.append(c);
      }
    }
    return ORDERED_LIST.matcher(out).replaceFirst("$1\\\\.");
  }

  /**
   * Discord text made into one plain game line: custom emoji become {@code :name:}, markdown
   * markers and backslash escapes are dropped, and the result is cleaned. It is still untrusted;
   * chat escapes it for MiniMessage.
   */
  public static String fromDiscord(String discordText) {
    var text = CUSTOM_EMOJI.matcher(discordText).replaceAll(":$1:");
    text = MARKDOWN_MARKERS.matcher(text).replaceAll("");
    text = BACKSLASH_ESCAPE.matcher(text).replaceAll("$1");
    return clean(text);
  }

  /** {@code text} cut to at most {@code max} code points, ending in an ellipsis when cut. */
  public static String truncate(String text, int max) {
    if (max < 1) {
      throw new IllegalArgumentException("max must be positive: " + max);
    }
    if (text.codePointCount(0, text.length()) <= max) {
      return text;
    }
    return text.substring(0, text.offsetByCodePoints(0, max - 1)) + String.valueOf((char) 0x2026);
  }
}
