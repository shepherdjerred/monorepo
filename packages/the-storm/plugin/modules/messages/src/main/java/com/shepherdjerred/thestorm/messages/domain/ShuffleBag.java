package com.shepherdjerred.thestorm.messages.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.OptionalInt;
import java.util.random.RandomGenerator;
import java.util.stream.IntStream;

/**
 * Draws list indexes in a random order without repeats: every entry comes up once before any comes
 * up twice, and a refill never starts with the entry that ended the previous round.
 *
 * @param size the list length; positive
 * @param pending indexes left in this round, drawn from the end
 * @param last the index drawn most recently, if any
 */
public record ShuffleBag(int size, List<Integer> pending, OptionalInt last) {

  public ShuffleBag {
    if (size < 1) {
      throw new IllegalArgumentException("a shuffle bag needs at least one entry: " + size);
    }
    pending = List.copyOf(pending);
    for (var index : pending) {
      if (index < 0 || index >= size) {
        throw new IllegalArgumentException("index " + index + " is outside 0.." + (size - 1));
      }
    }
  }

  /** An empty bag for a list of {@code size}; the first draw fills it. */
  public static ShuffleBag of(int size) {
    return new ShuffleBag(size, List.of(), OptionalInt.empty());
  }

  /** Draws the next index. */
  public Draw draw(RandomGenerator random) {
    var round = pending.isEmpty() ? refill(random) : new ArrayList<>(pending);
    var index = round.removeLast();
    return new Draw(index, new ShuffleBag(size, round, OptionalInt.of(index)));
  }

  private List<Integer> refill(RandomGenerator random) {
    var round = new ArrayList<>(IntStream.range(0, size).boxed().toList());
    // Fisher-Yates, drawing from the injected generator so rotations replay under a fixed seed.
    for (var i = round.size() - 1; i > 0; i--) {
      var j = random.nextInt(i + 1);
      var swap = round.get(i);
      round.set(i, round.get(j));
      round.set(j, swap);
    }
    if (size > 1 && last.isPresent() && round.getLast() == last.getAsInt()) {
      var first = round.getFirst();
      round.set(0, round.getLast());
      round.set(round.size() - 1, first);
    }
    return round;
  }

  /**
   * One draw.
   *
   * @param index the drawn list index
   * @param next the bag after the draw
   */
  public record Draw(int index, ShuffleBag next) {}
}
