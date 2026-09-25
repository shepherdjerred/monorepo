package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.grid.BlockGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.ArrayList;
import java.util.List;

/**
 * Plans opening and closing a {@link Structure}.
 *
 * <p>Opening takes every block of the material in the structure's cells into the stock. Closing
 * fills every other cell from the stock, and is refused whole if a cell holds something else or the
 * stock is short: a structure never half-closes. In every plan, the blocks of the material in the
 * cells plus the stock stay the same, so toggling can neither create nor destroy a block.
 */
public final class StructureToggle {

  private StructureToggle() {}

  /**
   * Plans moving {@code structure} toward {@code target}.
   *
   * @param grid the world as it is now
   * @param stock what the structure's signs hold
   */
  public static Result<StructurePlan, StructureProblem> plan(
      Structure structure, BlockGrid grid, Stock stock, Target target) {
    var material = structure.material();
    if (!stock.accepts(material)) {
      return Result.err(new StructureProblem.WrongStock(stock, material));
    }
    var standing = structure.cells().stream().filter(pos -> grid.cellAt(pos).is(material)).toList();
    var open =
        switch (target) {
          case OPEN -> true;
          case CLOSE -> false;
          case TOGGLE -> !standing.isEmpty();
        };
    return open ? open(material, standing, stock) : close(structure, grid, stock);
  }

  private static Result<StructurePlan, StructureProblem> open(
      String material, List<Pos> standing, Stock stock) {
    var changes = standing.stream().map(pos -> new BlockChange(pos, material, Cell.AIR)).toList();
    return Result.ok(new StructurePlan(true, changes, stock.plus(material, standing.size())));
  }

  private static Result<StructurePlan, StructureProblem> close(
      Structure structure, BlockGrid grid, Stock stock) {
    var material = structure.material();
    var changes = new ArrayList<BlockChange>();
    for (var pos : structure.cells()) {
      var cell = grid.cellAt(pos);
      if (cell.is(material)) {
        continue;
      }
      if (!cell.shape().isPlaceable()) {
        return Result.err(new StructureProblem.Obstructed(pos, cell.material()));
      }
      changes.add(new BlockChange(pos, cell.material(), material));
    }
    if (changes.size() > stock.count()) {
      return Result.err(
          new StructureProblem.NotEnoughBlocks(material, changes.size(), stock.count()));
    }
    return Result.ok(new StructurePlan(false, changes, stock.minus(changes.size())));
  }

  /**
   * Adds blocks a player hands to a structure's sign.
   *
   * @param material the structure's material
   * @param stock what the sign holds
   * @param offered what the player offers
   */
  public static Result<Stock, StructureProblem> deposit(
      String material, Stock stock, Stock offered) {
    if (offered.isEmpty()) {
      return Result.ok(stock);
    }
    var offeredMaterial = offered.material().orElseThrow();
    if (!offeredMaterial.equals(material)) {
      return Result.err(new StructureProblem.WrongMaterial(material, offeredMaterial));
    }
    if (!stock.accepts(material)) {
      return Result.err(new StructureProblem.WrongStock(stock, material));
    }
    return Result.ok(stock.plus(material, offered.count()));
  }
}
