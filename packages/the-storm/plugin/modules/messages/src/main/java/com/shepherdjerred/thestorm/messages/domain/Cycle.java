package com.shepherdjerred.thestorm.messages.domain;

/**
 * Walks a list in order and wraps around. Deterministic and random-free, so it is safe to advance
 * from any thread with a compare-and-set.
 *
 * @param size the list length; positive
 * @param position the index the next step returns
 */
public record Cycle(int size, int position) {

  public Cycle {
    if (size < 1) {
      throw new IllegalArgumentException("a cycle needs at least one entry: " + size);
    }
    if (position < 0 || position >= size) {
      throw new IllegalArgumentException("position " + position + " is outside 0.." + (size - 1));
    }
  }

  /** A cycle that starts at the first entry. */
  public static Cycle of(int size) {
    return new Cycle(size, 0);
  }

  /** The cycle after returning {@link #position()}. */
  public Cycle next() {
    return new Cycle(size, (position + 1) % size);
  }
}
