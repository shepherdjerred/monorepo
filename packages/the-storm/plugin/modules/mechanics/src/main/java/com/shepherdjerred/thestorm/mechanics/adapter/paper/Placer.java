package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.world.BlockChanges;
import com.shepherdjerred.thestorm.mechanics.domain.piston.BlockMove;
import com.shepherdjerred.thestorm.mechanics.domain.structure.BlockChange;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Structure;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.MultipleFacing;
import org.bukkit.block.data.Waterlogged;
import org.bukkit.block.data.type.Fence;
import org.bukkit.block.data.type.Gate;

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

    /** Checks and logs every final state before stock is debited or any block moves. */
    BlockChanges.Prepared prepare(BlockChanges writer, String actor) {
      var states = new LinkedHashMap<Block, BlockData>();
      for (var change : changes) {
        var block = grid.block(change.pos());
        states.put(block, change.isRemoval() ? Material.AIR.createBlockData() : template.clone());
      }
      states.forEach((block, data) -> connect(block, data, states));
      return writer.prepare(actor, updates(states));
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
  private static void connect(Block block, BlockData data, Map<Block, BlockData> states) {
    if (!(data instanceof MultipleFacing facing)) {
      return;
    }
    for (var side : SIDES) {
      if (facing.getAllowedFaces().contains(side)) {
        var neighbor = block.getRelative(side);
        var neighborData = states.getOrDefault(neighbor, neighbor.getBlockData());
        var neighborType = neighborData.getMaterial();
        var connects = neighborType == data.getMaterial() || neighborType.isOccluding();
        if (facing instanceof Fence) {
          connects =
              connects
                  || Tag.FENCES.isTagged(neighborType)
                  || (neighborData instanceof Gate gate
                      && gate.getFacing() != side
                      && gate.getFacing() != side.getOppositeFace());
        }
        facing.setFace(side, connects);
      }
    }
  }

  /** Computes and audits the complete final state before moving a block. */
  static void move(PaperGrid grid, List<BlockMove> moves, BlockChanges writer) {
    var states = new LinkedHashMap<Block, BlockData>();
    for (var move : moves) {
      var from = grid.block(move.from());
      var to = grid.block(move.to());
      var data = states.getOrDefault(from, from.getBlockData()).clone();
      states.put(to, data);
      states.put(from, Material.AIR.createBlockData());
    }
    writer.prepare("#storm-pistons", updates(states)).apply();
  }

  private static List<BlockChanges.Update> updates(Map<Block, BlockData> states) {
    return states.entrySet().stream()
        .map(entry -> new BlockChanges.Update(entry.getKey(), entry.getValue(), true))
        .toList();
  }
}
