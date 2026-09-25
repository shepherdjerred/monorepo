package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

/** A prepared spell's effect, applied once the cast has been paid for. */
@FunctionalInterface
public interface Effect {

  void apply();
}
