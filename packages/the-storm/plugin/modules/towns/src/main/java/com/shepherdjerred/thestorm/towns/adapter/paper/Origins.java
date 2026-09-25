package com.shepherdjerred.thestorm.towns.adapter.paper;

import org.bukkit.Location;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Projectile;
import org.bukkit.projectiles.BlockProjectileSource;

/** Where a world effect carried by an entity started. */
final class Origins {

  private Origins() {}

  /**
   * Where {@code entity}'s effect comes from: a projectile's dispenser or shooter; otherwise where
   * the entity was spawned (a falling block's starting point); otherwise where it is now.
   */
  static Location of(Entity entity) {
    if (entity instanceof Projectile projectile) {
      var shooter = projectile.getShooter();
      if (shooter instanceof BlockProjectileSource block) {
        return block.getBlock().getLocation();
      }
      if (shooter instanceof Entity source) {
        return source.getLocation();
      }
    }
    var origin = entity.getOrigin();
    return origin != null ? origin : entity.getLocation();
  }
}
