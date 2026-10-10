package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import org.bukkit.FluidCollisionMode;
import org.bukkit.Sound;
import org.bukkit.Tag;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.type.Door;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.util.Vector;

/** A reachable, visible wooden door is opened through the ordinary interaction event gates. */
final class DoorUse {
  private static final double REACH = 3;

  private DoorUse() {}

  static void ahead(Player player, Vector heading) {
    var horizontal = heading.clone().setY(0);
    if (horizontal.lengthSquared() < 1.0e-6) return;
    var hit =
        player
            .getWorld()
            .rayTraceBlocks(
                player.getEyeLocation(),
                horizontal.normalize(),
                REACH,
                FluidCollisionMode.NEVER,
                false);
    if (hit == null || hit.getHitBlock() == null || hit.getHitBlockFace() == null) return;
    var block = hit.getHitBlock();
    if (!Tag.WOODEN_DOORS.isTagged(block.getType())
        || !(block.getBlockData() instanceof Door door)
        || door.isOpen()) return;
    var event =
        new PlayerInteractEvent(
            player,
            Action.RIGHT_CLICK_BLOCK,
            player.getInventory().getItemInMainHand(),
            block,
            hit.getHitBlockFace(),
            EquipmentSlot.HAND);
    player.getServer().getPluginManager().callEvent(event);
    if (event.useInteractedBlock() == Event.Result.DENY) return;
    // A listener may have handled the interaction itself; read the world again after the event.
    if (!(block.getBlockData() instanceof Door observed) || observed.isOpen()) return;
    var other =
        block.getRelative(
            observed.getHalf() == Bisected.Half.BOTTOM ? BlockFace.UP : BlockFace.DOWN);
    if (other.getType() != block.getType()
        || !(other.getBlockData() instanceof Door counterpart)
        || counterpart.getHalf() == observed.getHalf()) {
      throw new IllegalStateException(
          "wooden door has no matching other half at " + block.getLocation());
    }
    observed.setOpen(true);
    counterpart.setOpen(true);
    block.setBlockData(observed, false);
    other.setBlockData(counterpart, false);
    player.swingMainHand();
    player.getWorld().playSound(block.getLocation(), Sound.BLOCK_WOODEN_DOOR_OPEN, 1, 1);
  }
}
