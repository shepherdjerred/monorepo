package com.shepherdjerred.thestorm.mechanics.domain.grid;

/** How a sign is held in place. */
public enum Mount {
  /** On a post, standing on the block below. */
  STANDING,
  /** On the side of a block, which sits directly behind the text. */
  WALL,
  /** Hanging from a ceiling or a wall bracket. */
  HANGING,
}
