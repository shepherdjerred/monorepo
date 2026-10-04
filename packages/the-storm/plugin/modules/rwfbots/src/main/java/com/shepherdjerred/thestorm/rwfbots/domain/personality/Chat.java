package com.shepherdjerred.thestorm.rwfbots.domain.personality;

import java.util.List;
import java.util.regex.Pattern;

/**
 * How a personality talks.
 *
 * @param toneTags lower-case tags such as {@code dry} or {@code hype}
 * @param verbosity how often it speaks
 * @param catchphrases up to five lines it may say verbatim
 */
public record Chat(List<String> toneTags, Verbosity verbosity, List<String> catchphrases) {

  public static final int MAX_CATCHPHRASES = 5;
  public static final int MAX_CATCHPHRASE_LENGTH = 100;

  private static final Pattern TAG = Pattern.compile("[a-z][a-z0-9-]{1,23}");

  /** How often a personality speaks. */
  public enum Verbosity {
    SILENT,
    TERSE,
    CHATTY
  }

  public Chat {
    toneTags = List.copyOf(toneTags);
    catchphrases = List.copyOf(catchphrases);
    for (var tag : toneTags) {
      if (!TAG.matcher(tag).matches()) {
        throw new IllegalArgumentException("bad tone tag: " + tag);
      }
    }
    if (catchphrases.size() > MAX_CATCHPHRASES) {
      throw new IllegalArgumentException("at most five catchphrases: " + catchphrases.size());
    }
    for (var phrase : catchphrases) {
      if (phrase.isBlank() || phrase.length() > MAX_CATCHPHRASE_LENGTH) {
        throw new IllegalArgumentException("catchphrases must be 1..100 chars: '" + phrase + "'");
      }
    }
  }

  public static Chat silent() {
    return new Chat(List.of(), Verbosity.SILENT, List.of());
  }
}
