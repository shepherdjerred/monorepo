package com.shepherdjerred.thestorm.rwfbots.domain.perception;

/** Everything perception carries from tick to tick. */
public record PerceptionState(Memory memory, Suspicion suspicion, long heardThrough) {

  public PerceptionState(Memory memory, Suspicion suspicion) {
    this(memory, suspicion, -1);
  }

  public static final PerceptionState EMPTY = new PerceptionState(Memory.EMPTY, Suspicion.NONE, -1);
}
