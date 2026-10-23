package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import java.util.Optional;

/**
 * Everything perception carries from tick to tick.
 *
 * @param memory the enemies the bot knows of
 * @param suspicion the disguised enemies it has caught
 * @param heardThrough the last stimulus sequence it has taken in
 * @param grudge who last hurt it, while that still matters
 */
public record PerceptionState(
    Memory memory, Suspicion suspicion, long heardThrough, Optional<Grudge> grudge) {

  public PerceptionState(Memory memory, Suspicion suspicion) {
    this(memory, suspicion, -1);
  }

  /** A state without a grudge: a fresh life starts calm. */
  public PerceptionState(Memory memory, Suspicion suspicion, long heardThrough) {
    this(memory, suspicion, heardThrough, Optional.empty());
  }

  public static final PerceptionState EMPTY = new PerceptionState(Memory.EMPTY, Suspicion.NONE, -1);

  /** The grudge still active at {@code now}. */
  public Optional<Grudge> grudgeAt(long now) {
    return grudge.filter(held -> held.activeAt(now));
  }
}
