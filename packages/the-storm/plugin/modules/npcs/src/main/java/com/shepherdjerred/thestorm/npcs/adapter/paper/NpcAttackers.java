package com.shepherdjerred.thestorm.npcs.adapter.paper;

import java.util.Optional;
import org.bukkit.damage.DamageSource;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.TNTPrimed;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;

/** Resolves direct attackers and the living source behind projectiles or primed TNT. */
final class NpcAttackers {
  private NpcAttackers() {}

  static Optional<LivingEntity> attacker(EntityDamageEvent event) {
    return attacker(event.getDamageSource())
        .or(
            () ->
                event instanceof EntityDamageByEntityEvent hit
                    ? behind(hit.getDamager())
                    : Optional.empty());
  }

  static Optional<LivingEntity> attacker(DamageSource source) {
    return Optional.ofNullable(source.getCausingEntity())
        .flatMap(NpcAttackers::behind)
        .or(() -> Optional.ofNullable(source.getDirectEntity()).flatMap(NpcAttackers::behind));
  }

  private static Optional<LivingEntity> behind(Entity entity) {
    return switch (entity) {
      case LivingEntity living -> Optional.of(living);
      case Projectile projectile ->
          projectile.getShooter() instanceof LivingEntity shooter
              ? Optional.of(shooter)
              : Optional.empty();
      case TNTPrimed tnt ->
          tnt.getSource() instanceof LivingEntity source ? Optional.of(source) : Optional.empty();
      default -> Optional.empty();
    };
  }
}
