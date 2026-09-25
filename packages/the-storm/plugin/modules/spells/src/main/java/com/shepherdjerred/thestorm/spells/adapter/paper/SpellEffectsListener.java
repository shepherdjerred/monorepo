package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.domain.geometry.Vec3;
import java.time.InstantSource;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.entity.Creeper;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityTargetLivingEntityEvent;
import org.bukkit.event.entity.ExplosionPrimeEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.potion.PotionEffectType;

/**
 * The lasting parts of spells: Stealth ends when its caster attacks and hides them from monsters,
 * Leap's landing does not hurt, Wards keep monsters from targeting anyone inside and creepers from
 * igniting, and a personal sky resets when its owner leaves.
 */
final class SpellEffectsListener implements Listener {

  private final SpellState state;
  private final InstantSource time;

  SpellEffectsListener(SpellState state, InstantSource time) {
    this.state = state;
    this.time = time;
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onAttack(EntityDamageByEntityEvent event) {
    attacker(event.getDamager())
        .filter(player -> state.stealth().stop(player.getUniqueId(), time.instant()))
        .ifPresent(
            player -> {
              player.removePotionEffect(PotionEffectType.INVISIBILITY);
              player.sendActionBar(Component.text("Your stealth breaks."));
            });
  }

  private static Optional<Player> attacker(Entity damager) {
    if (damager instanceof Player player) {
      return Optional.of(player);
    }
    if (damager instanceof Projectile projectile
        && projectile.getShooter() instanceof Player player) {
      return Optional.of(player);
    }
    return Optional.empty();
  }

  @EventHandler(ignoreCancelled = true)
  void onFall(EntityDamageEvent event) {
    if (event.getCause() == EntityDamageEvent.DamageCause.FALL
        && event.getEntity() instanceof Player player
        && state.featherFall().stop(player.getUniqueId(), time.instant())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onTarget(EntityTargetLivingEntityEvent event) {
    var target = event.getTarget();
    if (target == null) {
      return;
    }
    var hidden =
        target instanceof Player player
            && state.stealth().running(player.getUniqueId(), time.instant());
    if (hidden || (event.getEntity() instanceof Enemy && warded(target.getLocation()))) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onPrime(ExplosionPrimeEvent event) {
    if (event.getEntity() instanceof Creeper creeper && warded(creeper.getLocation())) {
      event.setCancelled(true);
    }
  }

  @EventHandler
  void onQuit(PlayerQuitEvent event) {
    var player = event.getPlayer();
    if (state.timeShifts().stop(player.getUniqueId(), time.instant())) {
      player.resetPlayerTime();
    }
  }

  private boolean warded(Location where) {
    var point = new Vec3(where.getX(), where.getY(), where.getZ());
    return state
        .wards()
        .covering(where.getWorld().getKey().asString(), point, time.instant())
        .isPresent();
  }
}
