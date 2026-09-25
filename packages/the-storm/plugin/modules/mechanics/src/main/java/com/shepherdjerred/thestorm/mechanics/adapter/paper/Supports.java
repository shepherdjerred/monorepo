package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import java.util.List;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Directional;
import org.bukkit.block.data.FaceAttachable;
import org.bukkit.block.data.MultipleFacing;
import org.bukkit.block.data.type.Bell;
import org.bukkit.block.data.type.Cocoa;
import org.bukkit.block.data.type.Door;
import org.bukkit.block.data.type.Ladder;
import org.bukkit.block.data.type.Lantern;
import org.bukkit.block.data.type.TripwireHook;
import org.bukkit.block.data.type.WallSign;
import org.bukkit.entity.Hanging;
import org.bukkit.util.BoundingBox;

/**
 * Whether a block holds something up: a block that would break off (and drop) if this block were
 * removed. Errs on the side of "yes": a mechanism refusing to move is harmless, a sign popping off
 * mid-toggle is not.
 */
final class Supports {

  private static final List<BlockFace> FACES =
      List.of(
          BlockFace.NORTH,
          BlockFace.EAST,
          BlockFace.SOUTH,
          BlockFace.WEST,
          BlockFace.UP,
          BlockFace.DOWN);

  private Supports() {}

  /** Whether anything is attached to {@code block}, rests on it or hangs from it. */
  static boolean anythingOn(Block block) {
    for (var face : FACES) {
      var neighbor = block.getRelative(face);
      if (!PaperGrid.loaded(neighbor) || dependsOn(neighbor, face)) {
        return true;
      }
    }
    return hangingEntityOn(block);
  }

  /** Whether {@code neighbor}, on {@code face} of a block, is held up by that block. */
  private static boolean dependsOn(Block neighbor, BlockFace face) {
    var type = neighbor.getType();
    if (type.isAir() || neighbor.isLiquid()) {
      return false;
    }
    var data = neighbor.getBlockData();
    var toward = face.getOppositeFace();
    if (Signs.isSign(type)) {
      return signHangsOn(neighbor, toward);
    }
    if (data instanceof FaceAttachable attachable) {
      return attachedFace(attachable, data) == toward;
    }
    if (isWallMounted(data)) {
      return ((Directional) data).getFacing().getOppositeFace() == toward;
    }
    if (data instanceof Cocoa cocoa) {
      return cocoa.getFacing() == toward;
    }
    if (data instanceof MultipleFacing facing && neighbor.isPassable()) {
      return facing.hasFace(toward);
    }
    if (face == BlockFace.UP) {
      return restsOn(neighbor, data);
    }
    return face == BlockFace.DOWN && hangsFrom(neighbor, data);
  }

  /** Signs: wall signs hang on the block behind them, standing ones on the block below. */
  private static boolean signHangsOn(Block sign, BlockFace toward) {
    var type = sign.getType();
    if (sign.getBlockData() instanceof WallSign wall) {
      return wall.getFacing().getOppositeFace() == toward;
    }
    if (Tag.STANDING_SIGNS.isTagged(type)) {
      return toward == BlockFace.DOWN;
    }
    if (Tag.CEILING_HANGING_SIGNS.isTagged(type)) {
      return toward == BlockFace.UP;
    }
    // Wall hanging signs rest on a block to either side; assume any neighbour holds them.
    return true;
  }

  private static BlockFace attachedFace(FaceAttachable attachable, BlockData data) {
    return switch (attachable.getAttachedFace()) {
      case FLOOR -> BlockFace.DOWN;
      case CEILING -> BlockFace.UP;
      case WALL -> ((Directional) data).getFacing().getOppositeFace();
    };
  }

  private static boolean isWallMounted(BlockData data) {
    return data instanceof Directional
        && (data instanceof Ladder
            || data instanceof TripwireHook
            || data.getMaterial().getKey().getKey().contains("wall_"));
  }

  /** Torches, rails, flowers, carpets, pressure plates, doors and the like on top. */
  private static boolean restsOn(Block above, BlockData data) {
    return above.isPassable() || data instanceof Door || Tag.WOOL_CARPETS.isTagged(above.getType());
  }

  /** Lanterns, bells, vines, roots and the like underneath. */
  private static boolean hangsFrom(Block below, BlockData data) {
    return below.isPassable()
        || (data instanceof Lantern lantern && lantern.isHanging())
        || (data instanceof Bell bell && bell.getAttachment() == Bell.Attachment.CEILING);
  }

  /** Item frames, paintings and leash knots touching {@code block}. */
  private static boolean hangingEntityOn(Block block) {
    var box = BoundingBox.of(block).expand(0.1);
    return !block.getWorld().getNearbyEntities(box, Hanging.class::isInstance).isEmpty();
  }
}
