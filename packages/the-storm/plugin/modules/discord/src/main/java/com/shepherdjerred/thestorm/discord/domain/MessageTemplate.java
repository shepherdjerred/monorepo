package com.shepherdjerred.thestorm.discord.domain;

import java.util.List;
import java.util.Map;

/**
 * A Discord message from config with {@code {name}} placeholders, such as {@code **{player}**
 * joined}. The template is trusted and may use markdown; values are inserted as given, in one pass,
 * so callers escape untrusted values with {@link DiscordText#forDiscord}.
 *
 * @param source the message
 * @param placeholders the placeholder names the message must use
 */
public record MessageTemplate(String source, List<String> placeholders) {

  public MessageTemplate {
    placeholders = List.copyOf(placeholders);
    if (source.isBlank()) {
      throw new IllegalArgumentException("a message must not be blank");
    }
    for (var name : placeholders) {
      if (!source.contains("{" + name + "}")) {
        throw new IllegalArgumentException("message must contain {" + name + "}: " + source);
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
      var close = c == '{' ? source.indexOf('}', i) : -1;
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
