package com.shepherdjerred.thestorm.chat.domain;

import java.util.List;
import java.util.Map;

/**
 * A trusted MiniMessage format from config with {@code <name>} placeholders, such as {@code
 * <dark_gray>[<dark_green>G</dark_green>][</dark_gray><prefix><player><dark_gray>]:
 * </dark_gray><gray><message>}.
 *
 * <p>Placeholders are filled in one pass, so a value can never introduce another placeholder.
 * Values are inserted as given: callers escape untrusted values with {@link MiniMessageText}.
 *
 * @param source the MiniMessage format
 * @param placeholders the placeholder names the format must use
 */
public record LineTemplate(String source, List<String> placeholders) {

  public LineTemplate {
    placeholders = List.copyOf(placeholders);
    for (var name : placeholders) {
      if (!source.contains("<" + name + ">")) {
        throw new IllegalArgumentException("format must contain <" + name + ">: " + source);
      }
    }
  }

  /** Fills every placeholder from {@code values}, which must name each one. */
  public String render(Map<String, String> values) {
    if (!values.keySet().containsAll(placeholders)) {
      throw new IllegalArgumentException("missing values for " + placeholders + ": " + values);
    }
    var out = new StringBuilder(source.length() + 64);
    var i = 0;
    while (i < source.length()) {
      var c = source.charAt(i);
      var close = c == '<' ? source.indexOf('>', i) : -1;
      var value = close < 0 ? null : values.get(source.substring(i + 1, close));
      if (value == null) {
        out.append(c);
        i++;
      } else {
        out.append(value);
        i = close + 1;
      }
    }
    return out.toString();
  }
}
