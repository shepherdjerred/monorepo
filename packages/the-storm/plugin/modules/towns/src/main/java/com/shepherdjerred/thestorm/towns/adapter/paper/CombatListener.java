package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.world.WorldEffect;
import io.papermc.paper.event.entity.EntityKnockbackEvent;
import io.papermc.paper.event.entity.EntityPushedByEntityAttackEvent;
import java.util.Optional;
import java.util.stream.Stream;
import org.bukkit.damage.DamageSource;
import org.bukkit.entity.AreaEffectCloud;
import org.bukkit.entity.Entity;
import org.bukkit.entity.FallingBlock;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.AreaEffectCloudApplyEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PotionSplashEvent;
import org.bukkit.event.weather.LightningStrikeEvent;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectTypeCategory;
import org.jspecify.annotations.Nullable;

/**
 * Hurting things: PvP, pets, protected animals and decorations, whether by hand, projectile, primed
 * TNT, splash or lingering potion, knockback, or channeling lightning; and explosions and dispenser
 * projectiles hurting protected entities.
 */
final class CombatListener implements Listener {

  private final Guard guard;

  CombatListener(Guard guard) {
    this.guard = guard;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onDamage(EntityDamageEvent event) {
    var victim = event.getEntity();
    var source = event.getDamageSource();
    // The damage source names the player behind it; the damager is the same player for events
    // built without a full source.
    var culprit =
        guard
            .culprit(source)
            .or(
                () ->
                    event instanceof EntityDamageByEntityEvent byEntity
                        ? guard.culprit(byEntity.getDamager())
                        : Optional.empty());
    if (culprit.isPresent()) {
      if (!guard.permitsHarm(culprit.get(), victim, true)) {
        event.setCancelled(true);
      }
      return;
    }
    var effect = worldEffect(source);
    if (effect == null) {
      return;
    }
    var origin = origin(source, victim);
    var land = guard.land(victim);
    var allowed =
        victim instanceof Player
            ? guard.allowsUntracedHarm(origin, land)
            : EntityKinds.subject(victim).isEmpty() || Guard.flows(effect, origin, land);
    if (!allowed) {
      event.setCancelled(true);
    }
  }

  /**
   * The world effect behind damage nobody can be blamed for, or null for ordinary damage (mobs,
   * falls, fire): explosions, falling blocks, potion clouds and projectiles nobody shot, such as a
   * dispenser's.
   */
  private static @Nullable WorldEffect worldEffect(DamageSource source) {
    if (Culprits.isExplosion(source)) {
      return WorldEffect.EXPLOSION;
    }
    return switch (source.getDirectEntity()) {
      case FallingBlock _ -> WorldEffect.FALLING_BLOCK;
      case AreaEffectCloud _ -> WorldEffect.PROJECTILE_IMPACT;
      case Projectile projectile when !(projectile.getShooter() instanceof Entity) ->
          WorldEffect.PROJECTILE_IMPACT;
      case null, default -> null;
    };
  }

  /**
   * Where untraced damage started: the entity carrying it back to its dispenser, TNT block or spawn
   * point, else the explosion's centre, else the victim's own land.
   */
  private Land origin(DamageSource source, Entity victim) {
    var direct = source.getDirectEntity();
    if (direct != null) {
      return guard.land(Origins.of(direct));
    }
    var from = source.getSourceLocation();
    return from != null ? guard.land(from) : guard.land(victim);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onSplash(PotionSplashEvent event) {
    var potion = event.getPotion();
    if (!harmful(potion.getEffects().stream())) {
      return;
    }
    var thrower = guard.culprit(potion);
    var origin = guard.land(Origins.of(potion));
    for (var victim : event.getAffectedEntities()) {
      if (!mayHarm(thrower, origin, victim)) {
        event.setIntensity(victim, 0);
      }
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onCloud(AreaEffectCloudApplyEvent event) {
    var cloud = event.getEntity();
    var base = cloud.getBasePotionType();
    var effects =
        Stream.concat(
            cloud.getCustomEffects().stream(),
            base == null ? Stream.empty() : base.getPotionEffects().stream());
    if (!harmful(effects)) {
      return;
    }
    var thrower = guard.culprit(cloud);
    var origin = guard.land(Origins.of(cloud));
    event.getAffectedEntities().removeIf(victim -> !mayHarm(thrower, origin, victim));
  }

  /** A potion from a player follows their harm rules; one from a dispenser, the border rules. */
  private boolean mayHarm(Optional<Culprit> thrower, Land origin, Entity victim) {
    if (thrower.isPresent()) {
      return guard.permitsHarm(thrower.get(), victim, true);
    }
    var land = guard.land(victim);
    if (victim instanceof Player) {
      return guard.allowsUntracedHarm(origin, land);
    }
    return EntityKinds.subject(victim).isEmpty()
        || Guard.flows(WorldEffect.PROJECTILE_IMPACT, origin, land);
  }

  /**
   * Knockback from hits, wind charges, maces and spears follows the damage rules, silently. An
   * explosion's push nobody can be blamed for moves protected entities only where explosions are
   * allowed.
   */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onKnockback(EntityKnockbackEvent event) {
    var victim = event.getEntity();
    if (event instanceof EntityPushedByEntityAttackEvent pushed) {
      var culprit = guard.culprit(pushed.getPushedBy());
      if (culprit.isPresent() && !guard.permitsHarm(culprit.get(), victim, false)) {
        event.setCancelled(true);
      }
      return;
    }
    if (event.getCause() == EntityKnockbackEvent.Cause.EXPLOSION
        && EntityKinds.subject(victim).isPresent()) {
      var land = guard.land(victim);
      event.setCancelled(!Guard.flows(WorldEffect.EXPLOSION, land, land));
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onLightning(LightningStrikeEvent event) {
    if (event.getCause() != LightningStrikeEvent.Cause.TRIDENT) {
      return;
    }
    var lightning = event.getLightning();
    var player = lightning.getCausingPlayer();
    if (player != null
        && !guard.permits(
            player, new Act(Action.DAMAGE_ENTITY, Subject.ENTITY), guard.land(lightning))) {
      event.setCancelled(true);
    }
  }

  private static boolean harmful(Stream<PotionEffect> effects) {
    return effects.anyMatch(
        effect -> effect.getType().getCategory() == PotionEffectTypeCategory.HARMFUL);
  }
}
