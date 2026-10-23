package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import com.shepherdjerred.thestorm.rwfbots.adapter.paper.WoodenDoors;
import org.bukkit.FluidCollisionMode;
import org.bukkit.entity.Player;
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
    WoodenDoors.set(player, hit.getHitBlock(), hit.getHitBlockFace(), true);
  }
}
