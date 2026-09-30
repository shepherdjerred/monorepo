package com.shepherdjerred.thestorm.chat.domain;

import java.util.Arrays;
import java.util.Locale;
import java.util.stream.Collectors;

/**
 * The 2017 caps rule. A message with too many all-capital words is still sent, but those words are
 * lowercased. A word counts when it has at least two letters and none of them are lowercase, so "I"
 * does not count and "OK?" does.
 */
public final class Shouting {

  private Shouting() {}

  /** How many words in {@code text} are all capitals. */
  public static long capsWords(String text) {
    return Arrays.stream(text.split(" ")).filter(Shouting::isCaps).count();
  }

  /**
   * {@code text} with its all-capital words lowercased when there are more than {@code max} of
   * them; otherwise {@code text} unchanged. Other words (names, "I") keep their case.
   */
  public static String calm(String text, int max) {
    if (capsWords(text) <= max) {
      return text;
    }
    return Arrays.stream(text.split(" ", -1))
        .map(word -> isCaps(word) ? word.toLowerCase(Locale.ROOT) : word)
        .collect(Collectors.joining(" "));
  }

  static boolean isCaps(String word) {
    var letters = 0;
    for (var i = 0; i < word.length(); i++) {
      var c = word.charAt(i);
      if (Character.isLowerCase(c)) {
        return false;
      }
      if (Character.isLetter(c)) {
        letters++;
      }
    }
    return letters >= 2;
  }
}
