package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

/** A prepared spell's effect, applied once the cast has been paid for. */
@FunctionalInterface
public interface Effect {

  void apply();

  /** Lets fallible persistent effects finish before the cast pays or starts its cooldown. */
  default void beforeCommit(Runnable commit, Runnable failed) {
    commit.run();
  }
}
