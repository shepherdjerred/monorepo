package com.shepherdjerred.thestorm.rwf.adapter.paper;

import java.util.Optional;
import org.bukkit.FluidCollisionMode;
import org.bukkit.entity.Player;

/**
 * Held right-clicks on bombs. A press that ends before the hand is raised stays the tap the
 * interact listener already sent; while the fuse stays raised and the look ray meets a bomb, each
 * tick is a hold sample.
 */
final class FuseHolds {

  private FuseHolds() {}

  /** The bomb {@code player} is holding the fuse on now, if any. */
  static Optional<String> aimed(Player player, Keys keys, BombMarkers bombs) {
    if (!player.isHandRaised() || !keys.isFuse(player.getInventory().getItemInMainHand())) {
      return Optional.empty();
    }
    var eye = player.getEyeLocation();
    var reach = PaperCombatantActions.REACH;
    var entity =
        player
            .getWorld()
            .rayTraceEntities(
                eye, eye.getDirection(), reach, candidate -> bombs.bombOf(candidate).isPresent());
    if (entity != null && entity.getHitEntity() != null) {
      return bombs.bombOf(entity.getHitEntity());
    }
    var block = player.getTargetBlockExact((int) reach, FluidCollisionMode.NEVER);
    if (block == null) {
      return Optional.empty();
    }
    return bombs.siteAt(Places.pos(block)).map(site -> site.id());
  }
}
