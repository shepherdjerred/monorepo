package com.shepherdjerred.thestorm.spells.adapter.paper;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.bukkit.FluidCollisionMode;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mannequin;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.bukkit.util.RayTraceResult;

/**
 * Finds what a spell acts on. Spells never affect their caster, armour stands, NPC mannequins,
 * invulnerable or dead creatures, spectators and creative players, or the configured immune bosses.
 */
public final class Targets {

  private final Set<EntityType> immune;

  public Targets(Set<EntityType> immune) {
    this.immune = Set.copyOf(immune);
  }

  /** True for the configured bosses no spell (nor Ward nor Stealth) ever affects. */
  public boolean isImmune(Entity entity) {
    return immune.contains(entity.getType());
  }

  /** True when a spell cast by {@code caster} may act on {@code entity}. */
  public boolean affectable(Player caster, Entity entity) {
    if (!(entity instanceof LivingEntity living)
        || entity.equals(caster)
        || entity instanceof ArmorStand
        || entity instanceof Mannequin) {
      return false;
    }
    if (!living.isValid() || living.isDead() || living.isInvulnerable()) {
      return false;
    }
    if (living instanceof Player player
        && (player.getGameMode() == GameMode.SPECTATOR
            || player.getGameMode() == GameMode.CREATIVE)) {
      return false;
    }
    return !immune.contains(entity.getType());
  }

  /** The creature {@code caster} looks at within {@code range}, unless a block is in the way. */
  public Optional<LivingEntity> inSight(Player caster, double range) {
    var eye = caster.getEyeLocation();
    var hit =
        caster
            .getWorld()
            .rayTrace(
                eye,
                eye.getDirection(),
                range,
                FluidCollisionMode.NEVER,
                true,
                0.3,
                entity -> affectable(caster, entity));
    if (hit != null && hit.getHitEntity() instanceof LivingEntity target) {
      return Optional.of(target);
    }
    return Optional.empty();
  }

  /** The block {@code caster} looks at within {@code range}. */
  public Optional<RayTraceResult> blockInSight(Player caster, double range) {
    var hit = caster.rayTraceBlocks(range, FluidCollisionMode.NEVER);
    return hit == null || hit.getHitBlock() == null ? Optional.empty() : Optional.of(hit);
  }

  /** Every affectable creature within {@code radius} of {@code centre}, nearest first. */
  public List<LivingEntity> around(Player caster, Location centre, double radius) {
    return centre
        .getWorld()
        .getNearbyLivingEntities(centre, radius, entity -> affectable(caster, entity))
        .stream()
        .filter(entity -> entity.getLocation().distance(centre) <= radius)
        .sorted(Comparator.comparingDouble(entity -> entity.getLocation().distanceSquared(centre)))
        .toList();
  }

  /**
   * Every affectable creature within {@code radius} of the caster that the caster can see: area
   * spells never reach through walls.
   */
  public List<LivingEntity> inView(Player caster, double radius) {
    Entity body = caster;
    return around(caster, body.getLocation(), radius).stream()
        .filter(caster::hasLineOfSight)
        .toList();
  }

  /** Every affectable hostile monster the caster can see within {@code radius}, nearest first. */
  public List<Mob> hostilesInView(Player caster, double radius) {
    return inView(caster, radius).stream()
        .filter(Enemy.class::isInstance)
        .filter(Mob.class::isInstance)
        .map(Mob.class::cast)
        .toList();
  }
}
