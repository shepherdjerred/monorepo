package com.shepherdjerred.thestorm.mobs.adapter.paper;

import java.util.Optional;
import org.bukkit.damage.DamageSource;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.persistence.PersistentDataType;

/**
 * Who hurt a levelled mob, kept in its persistent data so it survives chunk unloads and restarts.
 * Only a player's own hit or projectile counts as player damage; pets, traps, lava and falls do
 * not.
 */
final class KillLedger {

  private KillLedger() {}

  /** Records {@code amount} damage against {@code mob}. */
  static void record(LivingEntity mob, boolean byPlayer, double amount) {
    if (!(amount > 0)) {
      return;
    }
    var key = byPlayer ? MobKeys.PLAYER_DAMAGE : MobKeys.OTHER_DAMAGE;
    var data = mob.getPersistentDataContainer();
    var sofar = data.getOrDefault(key, PersistentDataType.DOUBLE, 0.0);
    data.set(key, PersistentDataType.DOUBLE, sofar + amount);
  }

  static double playerDamage(LivingEntity mob) {
    return mob.getPersistentDataContainer()
        .getOrDefault(MobKeys.PLAYER_DAMAGE, PersistentDataType.DOUBLE, 0.0);
  }

  static double otherDamage(LivingEntity mob) {
    return mob.getPersistentDataContainer()
        .getOrDefault(MobKeys.OTHER_DAMAGE, PersistentDataType.DOUBLE, 0.0);
  }

  /** The player behind a hit: the attacker themselves, or the shooter of a projectile. */
  static Optional<Player> playerHit(Entity damager) {
    if (damager instanceof Player player) {
      return Optional.of(player);
    }
    if (damager instanceof Projectile projectile
        && projectile.getShooter() instanceof Player shooter) {
      return Optional.of(shooter);
    }
    return Optional.empty();
  }

  /** The player whose own hit or projectile dealt a killing blow, if any. */
  static Optional<Player> finalBlow(DamageSource source) {
    var direct = source.getDirectEntity();
    return direct == null ? Optional.empty() : playerHit(direct);
  }
}
