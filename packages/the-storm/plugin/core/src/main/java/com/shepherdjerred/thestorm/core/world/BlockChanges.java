package com.shepherdjerred.thestorm.core.world;

import java.util.List;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;

/** Programmatic block changes must enter the audit queue before reaching the world. Main thread. */
@FunctionalInterface
public interface BlockChanges {
  Prepared prepare(String actor, List<Update> updates);

  default void set(String actor, Block block, BlockData replacement, boolean physics) {
    prepare(actor, List.of(new Update(block, replacement, physics))).apply();
  }

  /** One final state per block, captured independently of mutable caller data. */
  record Update(Block block, BlockData replacement, boolean physics) {
    public Update {
      replacement = replacement.clone();
    }
  }

  /** A single-use operation whose audit entries were accepted before inventory is debited. */
  @FunctionalInterface
  interface Prepared {
    void apply();
  }
}
