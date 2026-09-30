package com.shepherdjerred.thestorm.chat.domain;

/**
 * Escaping for text placed inside a MiniMessage document. Player and Discord text is escaped so it
 * can never open a tag (colors, click events, hover text, fonts) in the rendered line.
 */
public final class MiniMessageText {

  private MiniMessageText() {}

  /**
   * Escapes {@code text} so MiniMessage renders it literally. MiniMessage treats a backslash before
   * {@code <} or {@code \} as an escape, so both are escaped and nothing else changes.
   */
  public static String escape(String text) {
    var out = new StringBuilder(text.length() + 8);
    for (var i = 0; i < text.length(); i++) {
      var c = text.charAt(i);
      if (c == '<' || c == '\\') {
        out.append('\\');
      }
      out.append(c);
    }
    return out.toString();
  }
}
