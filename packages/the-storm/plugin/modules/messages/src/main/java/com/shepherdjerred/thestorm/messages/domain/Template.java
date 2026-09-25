package com.shepherdjerred.thestorm.messages.domain;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * A death-message template such as {@code "{player} was ravaged by a {killer}"}, split into literal
 * text and placeholders so the adapter can style each name without re-parsing.
 *
 * @param segments the text and placeholders in order; never empty
 */
public record Template(List<Segment> segments) {

  /** One piece of a template. */
  public sealed interface Segment {

    /** Literal text. */
    record Text(String value) implements Segment {
      public Text {
        if (value.isEmpty()) {
          throw new IllegalArgumentException("text segment must not be empty");
        }
      }
    }

    /** A name filled in when the message is sent. */
    record Slot(Placeholder placeholder) implements Segment {}
  }

  public Template {
    segments = List.copyOf(segments);
    if (segments.isEmpty()) {
      throw new IllegalArgumentException("template must not be empty");
    }
  }

  /**
   * Parses {@code source}. Braces are reserved for placeholders: an unknown name or an unbalanced
   * brace is rejected so a typo in the catalog fails at load, not in chat.
   */
  public static Template parse(String source) {
    var segments = new ArrayList<Segment>();
    var text = new StringBuilder();
    var index = 0;
    while (index < source.length()) {
      var character = source.charAt(index);
      if (character == '}') {
        throw new IllegalArgumentException("unmatched '}' in template: " + source);
      }
      if (character != '{') {
        text.append(character);
        index++;
        continue;
      }
      var close = source.indexOf('}', index);
      if (close < 0) {
        throw new IllegalArgumentException("unclosed '{' in template: " + source);
      }
      var name = source.substring(index + 1, close);
      var placeholder =
          Placeholder.named(name)
              .orElseThrow(
                  () ->
                      new IllegalArgumentException(
                          "unknown placeholder {" + name + "} in template: " + source));
      flush(text, segments);
      segments.add(new Segment.Slot(placeholder));
      index = close + 1;
    }
    flush(text, segments);
    return new Template(segments);
  }

  private static void flush(StringBuilder text, List<Segment> segments) {
    if (!text.isEmpty()) {
      segments.add(new Segment.Text(text.toString()));
      text.setLength(0);
    }
  }

  /** The placeholders this template mentions. */
  public Set<Placeholder> placeholders() {
    var used = EnumSet.noneOf(Placeholder.class);
    for (var segment : segments) {
      if (segment instanceof Segment.Slot(var placeholder)) {
        used.add(placeholder);
      }
    }
    return used;
  }

  /** Fills every placeholder from {@code values}, which must name each one this template uses. */
  public String render(Map<Placeholder, String> values) {
    return String.join("", fill(placeholder -> lookup(values, placeholder), text -> text));
  }

  /**
   * Maps each segment in order, turning literal text with {@code text} and placeholders with {@code
   * slot}. The adapter uses this to build styled components.
   */
  public <T> List<T> fill(
      Function<Placeholder, ? extends T> slot, Function<String, ? extends T> text) {
    var parts = new ArrayList<T>(segments.size());
    for (var segment : segments) {
      parts.add(
          switch (segment) {
            case Segment.Text(var value) -> text.apply(value);
            case Segment.Slot(var placeholder) -> slot.apply(placeholder);
          });
    }
    return parts;
  }

  /** The template as written in the catalog. */
  public String source() {
    return String.join("", fill(Placeholder::token, text -> text));
  }

  private static String lookup(Map<Placeholder, String> values, Placeholder placeholder) {
    var value = values.get(placeholder);
    if (value == null) {
      throw new IllegalArgumentException("no value for " + placeholder.token());
    }
    return value;
  }
}
