package com.shepherdjerred.thestorm.spells.domain;

import java.util.HashMap;
import java.util.Map;

/**
 * Focus generations: the anti-duplication rule for spell foci. A focus is valid only while its
 * generation is the latest bound for its owner and spell. Main thread only.
 */
public final class Foci {

  private final Map<FocusKey, Long> generations = new HashMap<>();

  /** Loads generations from storage. */
  public void restore(Map<FocusKey, Long> stored) {
    generations.putAll(stored);
  }

  /** Binds a new focus for {@code key}, invalidating every earlier one; returns its generation. */
  public long bind(FocusKey key) {
    return generations.merge(key, 1L, Long::sum);
  }

  /** Whether a focus of {@code generation} for {@code key} is the current one. */
  public boolean isCurrent(FocusKey key, long generation) {
    var current = generations.get(key);
    return current != null && current == generation;
  }
}
