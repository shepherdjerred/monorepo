package com.shepherdjerred.thestorm.rwfbots.domain.personality;

import java.util.HashSet;
import java.util.List;
import java.util.regex.Pattern;

/**
 * How a personality talks.
 *
 * @param toneTags one to four distinct lower-case tags such as {@code dry} or {@code hype}
 * @param verbosity how often it speaks
 * @param style a short note on how its lines read, such as "all lowercase, 2014 slang"
 */
public record Voice(List<String> toneTags, Verbosity verbosity, String style) {

  public static final int MAX_TONE_TAGS = 4;
  public static final int MAX_STYLE_LENGTH = 120;

  private static final Pattern TAG = Pattern.compile("[a-z][a-z0-9-]{1,23}");

  /** How often a personality speaks when it has something to say. */
  public enum Verbosity {
    /** Rarely: the big moments only. */
    QUIET,
    /** Some of the time. */
    NORMAL,
    /** Most of the time. */
    CHATTY
  }

  public Voice {
    toneTags = List.copyOf(toneTags);
    if (toneTags.isEmpty() || toneTags.size() > MAX_TONE_TAGS) {
      throw new IllegalArgumentException("voice needs 1..4 tone tags: " + toneTags);
    }
    if (new HashSet<>(toneTags).size() != toneTags.size()) {
      throw new IllegalArgumentException("tone tags must be distinct: " + toneTags);
    }
    for (var tag : toneTags) {
      if (!TAG.matcher(tag).matches()) {
        throw new IllegalArgumentException("bad tone tag: " + tag);
      }
    }
    if (style.isBlank() || !style.strip().equals(style) || style.length() > MAX_STYLE_LENGTH) {
      throw new IllegalArgumentException(
          "voice style must be 1..120 characters with no surrounding space: '" + style + "'");
    }
  }
}
