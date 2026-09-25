package com.shepherdjerred.thestorm.mechanics.domain.structure;

import java.util.List;

/**
 * An open or close, ready to apply.
 *
 * @param opened whether the structure ends up open
 * @param changes the blocks to set; empty when it is already in that state
 * @param stock what the sign holds afterwards
 */
public record StructurePlan(boolean opened, List<BlockChange> changes, Stock stock) {

  public StructurePlan {
    changes = List.copyOf(changes);
  }
}
