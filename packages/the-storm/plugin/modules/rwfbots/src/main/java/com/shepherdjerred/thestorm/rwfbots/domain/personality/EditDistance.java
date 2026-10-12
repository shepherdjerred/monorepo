package com.shepherdjerred.thestorm.rwfbots.domain.personality;

/** Levenshtein distance, for keeping bot names visibly distinct. */
public final class EditDistance {

  private EditDistance() {}

  /** The number of single-character edits turning {@code a} into {@code b}. */
  public static int levenshtein(String a, String b) {
    var previous = new int[b.length() + 1];
    var current = new int[b.length() + 1];
    for (var j = 0; j <= b.length(); j++) {
      previous[j] = j;
    }
    for (var i = 1; i <= a.length(); i++) {
      current[0] = i;
      for (var j = 1; j <= b.length(); j++) {
        var substitution = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
        current[j] =
            Math.min(Math.min(current[j - 1] + 1, previous[j] + 1), previous[j - 1] + substitution);
      }
      var swap = previous;
      previous = current;
      current = swap;
    }
    return previous[b.length()];
  }
}
