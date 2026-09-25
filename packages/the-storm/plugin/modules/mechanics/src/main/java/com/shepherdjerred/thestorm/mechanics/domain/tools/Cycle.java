package com.shepherdjerred.thestorm.mechanics.domain.tools;

import java.util.List;
import java.util.Optional;

/** Stepping through a fixed list of choices, wrapping at either end. */
public final class Cycle {

  private Cycle() {}

  /**
   * The choice after {@code current}, or before it when {@code forward} is false. A current value
   * not in the list steps to the first (or last) choice; a list with no other choice gives empty.
   */
  public static <T> Optional<T> step(List<T> choices, T current, boolean forward) {
    if (choices.isEmpty()) {
      return Optional.empty();
    }
    var index = choices.indexOf(current);
    if (index < 0) {
      return Optional.of(forward ? choices.getFirst() : choices.getLast());
    }
    if (choices.size() == 1) {
      return Optional.empty();
    }
    var next = Math.floorMod(index + (forward ? 1 : -1), choices.size());
    return Optional.of(choices.get(next));
  }
}
