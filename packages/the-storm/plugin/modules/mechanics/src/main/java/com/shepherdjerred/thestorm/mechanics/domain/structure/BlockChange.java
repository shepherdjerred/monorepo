package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;

/**
 * One block a plan sets.
 *
 * @param pos where
 * @param from the material there now, checked again when the plan is applied
 * @param to the material placed, {@link Cell#AIR} for a removal
 */
public record BlockChange(Pos pos, String from, String to) {

  public BlockChange {
    Cell.requireMaterialKey(from);
    Cell.requireMaterialKey(to);
  }

  public boolean isRemoval() {
    return to.equals(Cell.AIR);
  }
}
