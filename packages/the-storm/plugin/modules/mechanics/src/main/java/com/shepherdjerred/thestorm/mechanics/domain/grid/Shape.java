package com.shepherdjerred.thestorm.mechanics.domain.grid;

/** How a block's space behaves for things that move through it or build into it. */
public enum Shape {
  /** Air. */
  EMPTY,
  /** Walk-through and harmless: flowers, torches, signs, open trapdoors. */
  PASSABLE,
  /** Water and other harmless fluids. */
  LIQUID,
  /** Hurts whoever stands in or on it: lava, fire, magma, cactus, powder snow. */
  HAZARD,
  /** Collides: something can stand on it. */
  SOLID;

  /** A mechanism may place a block here without destroying anything of value. */
  public boolean isPlaceable() {
    return this == EMPTY || this == LIQUID;
  }

  /** A player's body can occupy this space safely. */
  public boolean isBreathable() {
    return this == EMPTY || this == PASSABLE;
  }
}
