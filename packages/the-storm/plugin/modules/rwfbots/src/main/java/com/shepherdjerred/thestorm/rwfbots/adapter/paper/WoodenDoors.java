package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.DoorShut;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.bukkit.Sound;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.type.Door;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;

/**
 * A body opens and shuts wooden doors as a player does: a right click through the ordinary
 * interaction event, which rules may deny and {@link DoorVisibility} observes. Iron doors need
 * redstone and trapdoors and fence gates are baked as fixed terrain, so only wooden doors are used.
 */
public final class WoodenDoors {

  /** How far round the body's feet open doors are looked for, in blocks. */
  private static final int SEARCH = (int) Math.ceil(DoorShut.REACH);

  private WoodenDoors() {}

  /**
   * Right clicks {@code block}, a wooden door half, on {@code face} so it ends {@code open}.
   * Returns whether the door changed: nothing happens when it already is, when it is not a wooden
   * door, or when a rule denies the click.
   */
  public static boolean set(Player player, Block block, BlockFace face, boolean open) {
    if (!Tag.WOODEN_DOORS.isTagged(block.getType())
        || !(block.getBlockData() instanceof Door door)
        || door.isOpen() == open) return false;
    var event =
        new PlayerInteractEvent(
            player,
            Action.RIGHT_CLICK_BLOCK,
            player.getInventory().getItemInMainHand(),
            block,
            face,
            EquipmentSlot.HAND);
    player.getServer().getPluginManager().callEvent(event);
    if (event.useInteractedBlock() == Event.Result.DENY) return false;
    // A listener may have handled the interaction itself; read the world again after the event.
    if (!(block.getBlockData() instanceof Door observed) || observed.isOpen() == open) return false;
    var other =
        block.getRelative(
            observed.getHalf() == Bisected.Half.BOTTOM ? BlockFace.UP : BlockFace.DOWN);
    if (other.getType() != block.getType()
        || !(other.getBlockData() instanceof Door counterpart)
        || counterpart.getHalf() == observed.getHalf()) {
      throw new IllegalStateException(
          "wooden door has no matching other half at " + block.getLocation());
    }
    observed.setOpen(open);
    counterpart.setOpen(open);
    block.setBlockData(observed, false);
    other.setBlockData(counterpart, false);
    player.swingMainHand();
    player
        .getWorld()
        .playSound(
            block.getLocation(),
            open ? Sound.BLOCK_WOODEN_DOOR_OPEN : Sound.BLOCK_WOODEN_DOOR_CLOSE,
            1,
            1);
    return true;
  }

  /**
   * Pulls shut the open door {@link DoorShut} picks for a body breaking contact. Returns whether a
   * door was shut.
   */
  public static boolean shutBehind(Player player, DoorShut.Escape escape) {
    if (!DoorShut.escaping(escape.decision())) return false;
    var door = DoorShut.behind(escape, openNear(player));
    if (door.isEmpty()) return false;
    var cell = door.orElseThrow();
    var block = player.getWorld().getBlockAt(cell.x(), cell.y(), cell.z());
    return set(player, block, facing(player, block), false);
  }

  /** The lower halves of the open wooden doors within reach of the body's feet. */
  static List<BlockPos> openNear(Player player) {
    var feet = Objects.requireNonNull(player.getLocation(), "a live bot has a location").getBlock();
    var world = player.getWorld();
    var found = new ArrayList<BlockPos>();
    for (var dy = -1; dy <= 1; dy++) {
      for (var dz = -SEARCH; dz <= SEARCH; dz++) {
        for (var dx = -SEARCH; dx <= SEARCH; dx++) {
          var block = world.getBlockAt(feet.getX() + dx, feet.getY() + dy, feet.getZ() + dz);
          if (Tag.WOODEN_DOORS.isTagged(block.getType())
              && block.getBlockData() instanceof Door door
              && door.isOpen()
              && door.getHalf() == Bisected.Half.BOTTOM)
            found.add(new BlockPos(block.getX(), block.getY(), block.getZ()));
        }
      }
    }
    return found;
  }

  /** The face of {@code block} turned towards the body, as a player's click would hit it. */
  private static BlockFace facing(Player player, Block block) {
    var at = Objects.requireNonNull(player.getLocation(), "a live bot has a location");
    var dx = at.getX() - (block.getX() + 0.5);
    var dz = at.getZ() - (block.getZ() + 0.5);
    if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? BlockFace.EAST : BlockFace.WEST;
    return dz >= 0 ? BlockFace.SOUTH : BlockFace.NORTH;
  }
}
