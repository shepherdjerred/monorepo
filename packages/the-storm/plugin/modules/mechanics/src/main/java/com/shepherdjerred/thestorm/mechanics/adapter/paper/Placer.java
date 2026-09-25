package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.mechanics.domain.piston.BlockMove;
import com.shepherdjerred.thestorm.mechanics.domain.structure.BlockChange;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Structure;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.MultipleFacing;
import org.bukkit.block.data.Waterlogged;

/**
 * Applies domain plans to the world. Plans are made and applied in the same tick, so each change
 * still finds the block its plan saw; anything else is a bug and fails loudly.
 */
final class Placer {

  private static final List<BlockFace> SIDES =
      List.of(BlockFace.NORTH, BlockFace.EAST, BlockFace.SOUTH, BlockFace.WEST);

  private Placer() {}

  /**
   * A checked set of structure changes, ready to place.
   *
   * @param grid the world
   * @param template the block data placed blocks copy
   * @param changes what to set
   */
  record Placement(PaperGrid grid, BlockData template, List<BlockChange> changes) {

    /** Sets every change. Everything was checked beforehand; nothing here can fail. */
    void apply() {
      var placed = new ArrayList<Block>();
      for (var change : changes) {
        var block = grid.block(change.pos());
        if (change.isRemoval()) {
          block.setType(Material.AIR, true);
        } else {
          block.setBlockData(template.clone(), true);
          placed.add(block);
        }
      }
      placed.forEach(Placer::connect);
    }
  }

  /**
   * Checks every change before any block is touched: each still finds the block its plan saw, and
   * the template is the structure's material in a one-item form (config verification refuses any
   * other, so a failure here is a broken invariant). Placed copies are never waterlogged.
   */
  static Placement check(PaperGrid grid, Structure structure, List<BlockChange> changes) {
    var template = grid.block(structure.template()).getBlockData().clone();
    if (!PaperGrid.key(template.getMaterial()).equals(structure.material())
        || !Materials.isSingleItem(template)) {
      throw new IllegalStateException("not a one-item template for a structure: " + template);
    }
    if (template instanceof Waterlogged waterlogged) {
      waterlogged.setWaterlogged(false);
    }
    for (var change : changes) {
      var found = PaperGrid.key(grid.block(change.pos()).getType());
      if (!found.equals(change.from())) {
        throw new IllegalStateException(
            "plan expected " + change.from() + " at " + change.pos() + " but found " + found);
      }
    }
    return new Placement(grid, template, changes);
  }

  /**
   * Joins a placed fence, pane or bar to its neighbours. Vanilla updates the neighbours of a set
   * block but not the block itself, so its own sides are worked out here.
   */
  private static void connect(Block block) {
    if (!(block.getBlockData() instanceof MultipleFacing facing)) {
      return;
    }
    for (var side : SIDES) {
      if (facing.getAllowedFaces().contains(side)) {
        var neighbor = block.getRelative(side).getType();
        facing.setFace(side, neighbor == block.getType() || neighbor.isOccluding());
      }
    }
    block.setBlockData(facing, false);
  }

  /** Moves blocks in plan order: each destination is filled before its source is emptied. */
  static void move(PaperGrid grid, List<BlockMove> moves) {
    for (var move : moves) {
      var from = grid.block(move.from());
      var to = grid.block(move.to());
      var data = from.getBlockData().clone();
      to.setBlockData(data, true);
      from.setType(Material.AIR, true);
    }
  }
}
