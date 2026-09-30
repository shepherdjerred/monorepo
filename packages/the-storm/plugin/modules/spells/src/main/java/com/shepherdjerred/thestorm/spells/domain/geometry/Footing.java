package com.shepherdjerred.thestorm.spells.domain.geometry;

/** What a block means to someone arriving next to it. */
public enum Footing {
  /** Something to stand on: a full, harmless block. */
  SOLID,
  /** Room to stand in: air, grass, open doors and other harmless passable blocks. */
  OPEN,
  /**
   * Neither: lava, fire, magma, cactus, powder snow, berry bushes, fluids to stand on, partial
   * blocks, or outside the world.
   */
  HAZARD
}
