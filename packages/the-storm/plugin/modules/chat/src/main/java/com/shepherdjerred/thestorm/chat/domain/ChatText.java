package com.shepherdjerred.thestorm.chat.domain;

/** Cleans untrusted chat text before it is filtered, formatted or relayed. */
public final class ChatText {

  /** The legacy formatting prefix; the client still honours it inside plain text. */
  static final char SECTION_SIGN = '§';

  private ChatText() {}

  /**
   * Removes control and invisible formatting characters and legacy {@code §} codes, turns every run
   * of whitespace into one space and trims the result.
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
}
