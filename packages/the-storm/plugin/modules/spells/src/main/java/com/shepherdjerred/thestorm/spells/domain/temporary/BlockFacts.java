package com.shepherdjerred.thestorm.spells.domain.temporary;

/**
 * What the adapter observed about a block a spell wants to replace.
 *
 * @param kind the block's broad kind
 * @param blockEntity whether it has a block entity (chests, signs, spawners, beds, banners, ...)
 * @param multiBlock whether it is part of a larger block (tall grass, doors, beds)
 */
public record BlockFacts(Kind kind, boolean blockEntity, boolean multiBlock) {

  /** The broad kinds a temporary block may care about. */
  public enum Kind {
    /** Air of any kind. */
    AIR,
    /** A one-block plant or snow layer that vanilla lets you build over without breaking. */
    SOFT,
    /** A still water source. */
    WATER_SOURCE,
    /** Anything else: solid blocks, flowing or other fluids, fire, ores, valuables. */
    OTHER
  }

  public static BlockFacts air() {
    return new BlockFacts(Kind.AIR, false, false);
  }
}
