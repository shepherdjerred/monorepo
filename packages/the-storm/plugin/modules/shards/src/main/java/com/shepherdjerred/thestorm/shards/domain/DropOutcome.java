package com.shepherdjerred.thestorm.shards.domain;

/** Whether a kill or break drops shards, and if not, why. */
public sealed interface DropOutcome {

  /** Shards drop. */
  record Dropped(int amount) implements DropOutcome {
    public Dropped {
      if (amount < 1) {
        throw new IllegalArgumentException("a drop must yield at least one shard: " + amount);
      }
    }
  }

  /** Nothing drops. */
  record Nothing(Reason reason) implements DropOutcome {}

  /** Why nothing dropped. */
  enum Reason {
    /** The world is not in {@code drops.worlds}. */
    WORLD_EXCLUDED,
    /** The mob or block has no drop rule. */
    NOT_A_SOURCE,
    /** No player landed the killing blow. */
    NOT_KILLED_BY_PLAYER,
    /** The mob came from a spawner, egg, command or plugin. */
    ARTIFICIAL_SPAWN,
    /** A player placed the block, so it is not a natural find. */
    PLACED_BY_PLAYER,
    /** Silk Touch keeps the block whole, and the shard inside it. */
    SILK_TOUCH,
    /** The break drops nothing at all (creative mode, wrong tool). */
    NO_ITEM_DROPS,
    /** The roll missed. */
    UNLUCKY
  }
}
