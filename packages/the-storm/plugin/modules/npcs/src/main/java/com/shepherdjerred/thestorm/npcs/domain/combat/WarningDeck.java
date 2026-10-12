package com.shepherdjerred.thestorm.npcs.domain.combat;

import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;

/** Shuffled warning phrases, each used once before reshuffling. */
public final class WarningDeck {
  private final List<String> phrases;
  private final RandomGenerator random;
  private int next;

  public WarningDeck(List<String> phrases, RandomGenerator random) {
    this.phrases = new ArrayList<>(phrases);
    this.random = random;
    shuffle();
  }

  public String next() {
    if (next == phrases.size()) {
      var previous = phrases.getLast();
      shuffle();
      if (phrases.getFirst().equals(previous)) {
        var first = phrases.getFirst();
        phrases.set(0, phrases.get(1));
        phrases.set(1, first);
      }
    }
    return phrases.get(next++);
  }

  private void shuffle() {
    if (phrases.size() < 2) {
      throw new IllegalArgumentException("warning deck needs at least two phrases");
    }
    for (var end = phrases.size() - 1; end > 0; end--) {
      var chosen = random.nextInt(end + 1);
      var last = phrases.get(end);
      phrases.set(end, phrases.get(chosen));
      phrases.set(chosen, last);
    }
    next = 0;
  }
}
