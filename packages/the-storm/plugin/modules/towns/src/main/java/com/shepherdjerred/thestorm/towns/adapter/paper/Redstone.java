package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.world.WorldEffect;
import java.util.List;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Bisected;

/**
 * Whether redstone power reaching a block could come from another owner's land: from a component
 * beside it, or one hop through a solid block beside it whose own neighbour is a component on other
 * land. Doors are checked on both halves.
 */
final class Redstone {

  static final List<BlockFace> FACES =
      List.of(
          BlockFace.NORTH,
          BlockFace.EAST,
          BlockFace.SOUTH,
          BlockFace.WEST,
          BlockFace.UP,
          BlockFace.DOWN);

  private final Guard guard;
  private final BlockKinds kinds;

  Redstone(Guard guard, BlockKinds kinds) {
    this.guard = guard;
    this.kinds = kinds;
  }

  /** True when power reaching {@code block} (and a door's other half) may come from other land. */
  boolean foreignPower(Block block) {
    var land = guard.land(block);
    if (land instanceof Land.Wilderness) {
      return false;
    }
    if (reachesFromElsewhere(block, land)) {
      return true;
    }
    if (block.getBlockData() instanceof Bisected half) {
      var other =
          block.getRelative(half.getHalf() == Bisected.Half.TOP ? BlockFace.DOWN : BlockFace.UP);
      return reachesFromElsewhere(other, land);
    }
    return false;
  }

  /**
   * True when a piston at {@code piston}, or the block above it (which also powers pistons), may be
   * powered from other land.
   */
  boolean foreignPistonPower(Block piston) {
    var land = guard.land(piston);
    if (land instanceof Land.Wilderness) {
      return false;
    }
    return reachesFromElsewhere(piston, land)
        || reachesFromElsewhere(piston.getRelative(BlockFace.UP), land);
  }

  /**
   * True when a redstone component on other land touches {@code block}, or touches a solid block
   * that touches it. Checked when the block is being powered, so the component is a likely source;
   * the check looks at block types only, never at power levels, so it stays cheap.
   */
  private boolean reachesFromElsewhere(Block block, Land land) {
    for (var face : FACES) {
      var neighbour = block.getRelative(face);
      var type = neighbour.getType();
      if (kinds.isRedstone(type)
          && !Guard.flows(WorldEffect.REDSTONE, guard.land(neighbour), land)) {
        return true;
      }
      if (type.isOccluding() && componentBeyond(neighbour, block, land)) {
        return true;
      }
    }
    return false;
  }

  private boolean componentBeyond(Block solid, Block from, Land land) {
    for (var face : FACES) {
      var beyond = solid.getRelative(face);
      if (!beyond.equals(from)
          && kinds.isRedstone(beyond.getType())
          && !Guard.flows(WorldEffect.REDSTONE, guard.land(beyond), land)) {
        return true;
      }
    }
    return false;
  }
}
