package com.shepherdjerred.thestorm.rwfbots.domain.map;

/**
 * The shape classes a block is sorted into before baking. The adapter decides the class from the
 * Paper block data; the baker never sees a material.
 */
public enum BlockShape {
  FULL(0, true, true, Motion.NONE),
  SLAB_BOTTOM(1, true, true, Motion.NONE),
  SLAB_TOP(2, true, true, Motion.NONE),
  STAIRS(3, true, true, Motion.NONE),
  FENCE(4, true, false, Motion.NONE),
  PANE(5, true, false, Motion.NONE),
  LIQUID(6, false, false, Motion.SWIM),
  LADDER(7, false, false, Motion.CLIMB),
  PASSABLE(8, false, false, Motion.NONE);

  private enum Motion {
    NONE,
    SWIM,
    CLIMB
  }

  private final byte code;
  private final boolean blocksMovement;
  private final boolean standable;
  private final Motion motion;

  BlockShape(int code, boolean blocksMovement, boolean standable, Motion motion) {
    this.code = (byte) code;
    this.blocksMovement = blocksMovement;
    this.standable = standable;
    this.motion = motion;
  }

  /** The stable byte used when digesting a classification. */
  public byte code() {
    return code;
  }

  /** Whether a player cannot occupy this cell. */
  public boolean blocksMovement() {
    return blocksMovement;
  }

  /** Whether a player can stand on top of this cell. */
  public boolean standable() {
    return standable;
  }

  /** Whether a player can climb in this cell. */
  public boolean climbable() {
    return motion == Motion.CLIMB;
  }

  /** Whether a player swims in this cell. */
  public boolean swim() {
    return motion == Motion.SWIM;
  }

  /** Whether arrows stop in this cell. Thin glass and fences stop arrows; air and water do not. */
  public boolean blocksProjectile() {
    return blocksMovement;
  }

  /** The shape with code {@code code}; anything else is corrupt data. */
  public static BlockShape ofCode(byte code) {
    for (var shape : values()) {
      if (shape.code == code) {
        return shape;
      }
    }
    throw new IllegalArgumentException("unknown block shape code: " + code);
  }
}
