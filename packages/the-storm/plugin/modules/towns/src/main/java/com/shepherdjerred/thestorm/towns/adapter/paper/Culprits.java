package com.shepherdjerred.thestorm.towns.adapter.paper;

import java.util.Optional;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.AreaEffectCloud;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LightningStrike;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.TNTPrimed;
import org.jspecify.annotations.Nullable;

/**
 * Finds the player behind an entity: the player themselves, the shooter of a projectile, whoever
 * lit primed TNT, the thrower of a lingering potion, or the player who called channeling lightning.
 */
final class Culprits {

  /** How many hops (TNT lit by an arrow shot by a player) are followed. */
  private static final int MAX_DEPTH = 3;

  private Culprits() {}

  static Optional<Player> behind(@Nullable Entity entity) {
    return behind(entity, MAX_DEPTH);
  }

  static Optional<Player> behind(DamageSource source) {
    var causing = source.getCausingEntity();
    return causing != null ? behind(causing) : behind(source.getDirectEntity());
  }

  /**
   * True when {@code source} is an explosion: TNT, creepers, crystals, beds, anchors, fireworks.
   */
  static boolean isExplosion(DamageSource source) {
    var type = source.getDamageType();
    return type.equals(DamageType.EXPLOSION)
        || type.equals(DamageType.PLAYER_EXPLOSION)
        || type.equals(DamageType.BAD_RESPAWN_POINT)
        || type.equals(DamageType.FIREWORKS);
  }

  private static Optional<Player> behind(@Nullable Entity entity, int depth) {
    if (entity == null || depth == 0) {
      return Optional.empty();
    }
    return switch (entity) {
      case Player player -> Optional.of(player);
      case Projectile projectile ->
          projectile.getShooter() instanceof Entity shooter
              ? behind(shooter, depth - 1)
              : Optional.empty();
      case TNTPrimed tnt -> behind(tnt.getSource(), depth - 1);
      case AreaEffectCloud cloud ->
          cloud.getSource() instanceof Entity source ? behind(source, depth - 1) : Optional.empty();
      case LightningStrike lightning -> Optional.ofNullable(lightning.getCausingPlayer());
      default -> Optional.empty();
    };
  }
}
