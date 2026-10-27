package com.shepherdjerred.thestorm.mobs.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.mobs.domain.config.MobsConfig;
import com.shepherdjerred.thestorm.mobs.domain.scaling.Stat;
import java.util.Objects;
import java.util.OptionalLong;
import org.bukkit.Location;
import org.bukkit.entity.Boss;
import org.bukkit.entity.Creeper;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityTargetLivingEntityEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.world.EntitiesLoadEvent;
import org.jspecify.annotations.Nullable;

/**
 * Real shared levels; ordinary aggression remains intact. Never heals or re-rolls natural levels.
 */
final class BeginnerLuckListener implements Listener {
  private final ModuleContext context;
  private final MobsConfig config;
  private final LevelApplier levels;
  private final BeginnerProtection protection;
  private final SealedWorlds sealed;

  BeginnerLuckListener(
      ModuleContext context,
      MobsConfig config,
      LevelApplier levels,
      BeginnerProtection protection) {
    this.context = context;
    this.config = config;
    this.levels = levels;
    this.protection = protection;
    sealed = context.services().require(SealedWorlds.class);
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void onSpawn(CreatureSpawnEvent event) {
    var mob = event.getEntity();
    if (ordinary(mob) && levels.levelOf(mob).isPresent() && tooManyNearby(mob)) {
      event.setCancelled(true);
      return;
    }
    reconcile(mob);
  }

  private boolean tooManyNearby(LivingEntity mob) {
    var radius = config.beginnerLuck().radius();
    for (var player : mob.getWorld().getNearbyPlayers(mob.getLocation(), radius)) {
      if (!capped(player)) continue;
      var nearby = player.getNearbyEntities(radius, radius, radius);
      var count =
          nearby.stream()
              .filter(entity -> !entity.equals(mob))
              .filter(LivingEntity.class::isInstance)
              .map(LivingEntity.class::cast)
              .filter(entity -> ordinary(entity) && levels.levelOf(entity).isPresent())
              .count();
      if (count >= config.beginnerLuck().maxAggro()) return true;
    }
    return false;
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void onTarget(EntityTargetLivingEntityEvent event) {
    if (event.getTarget() instanceof Player player && crowded(event.getEntity(), player)) {
      event.setCancelled(true);
      return;
    }
    reconcile(event.getEntity(), event.getTarget() instanceof Player player ? player : null);
  }

  private boolean capped(Player player) {
    var active = active(player);
    return active.isPresent()
        && active.getAsLong() < config.beginnerLuck().normalAfter().toMillis();
  }

  /** A new ordinary target is refused once this player already has maxAggro ordinary enemies. */
  private boolean crowded(Entity entity, Player player) {
    if (!(entity instanceof Mob mob) || !ordinary(mob) || !capped(player)) return false;
    if (Objects.equals(mob.getTarget(), player)) return false;
    var radius = config.beginnerLuck().radius();
    var already = 0;
    for (var nearby : player.getNearbyEntities(radius, radius, radius)) {
      if (nearby instanceof Mob other
          && !Objects.equals(other, mob)
          && ordinary(other)
          && Objects.equals(other.getTarget(), player)) already++;
    }
    return already >= config.beginnerLuck().maxAggro();
  }

  @EventHandler
  void onLoad(EntitiesLoadEvent event) {
    event.getEntities().forEach(this::reconcile);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onJoin(PlayerJoinEvent event) {
    var _ =
        protection
            .status(event.getPlayer().getUniqueId())
            .thenRunAsync(
                () -> nearby(event.getPlayer().getLocation()), context.scheduler().mainThread());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onQuit(PlayerQuitEvent event) {
    protection.left(event.getPlayer());
    var at = event.getPlayer().getLocation();
    context.scheduler().runOnMainThread(() -> nearby(at));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onMove(PlayerMoveEvent event) {
    if ((event.getFrom().getBlockX() >> 4) != (event.getTo().getBlockX() >> 4)
        || (event.getFrom().getBlockZ() >> 4) != (event.getTo().getBlockZ() >> 4)) {
      nearby(event.getFrom());
      nearby(event.getTo());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onTeleport(PlayerTeleportEvent event) {
    var from = event.getFrom();
    context
        .scheduler()
        .runOnMainThread(
            () -> {
              nearby(from);
              nearby(event.getPlayer().getLocation());
            });
  }

  /** Melee damage was computed before this event; correct its old attribute multiplier too. */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void beforeDamage(EntityDamageByEntityEvent event) {
    var causing = event.getDamageSource().getCausingEntity();
    if (causing instanceof LivingEntity mob && ordinary(mob)) {
      var before = levels.bonus(mob, Stat.ATTACK_DAMAGE);
      reconcile(mob, event.getEntity() instanceof Player player ? player : null);
      if (!(event.getDamager() instanceof Projectile) && !(mob instanceof Creeper)) {
        event.setDamage(
            event.getDamage() * (1 + levels.bonus(mob, Stat.ATTACK_DAMAGE)) / (1 + before));
      }
    }
    if (event.getEntity() instanceof LivingEntity mob) reconcile(mob);
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void onDamage(EntityDamageByEntityEvent event) {
    if (!(event.getEntity() instanceof Player player)
        || !(event.getDamageSource().getCausingEntity() instanceof LivingEntity mob)
        || !ordinary(mob)) return;
    var active = active(player);
    if (active.isPresent())
      event.setDamage(
          event.getDamage() * config.beginnerLuck().damageMultiplier(active.getAsLong()));
  }

  private OptionalLong active(Player player) {
    if (sealed.isSealed(player.getWorld())
        || config.levels().world(player.getWorld().getName()).isEmpty())
      return OptionalLong.empty();
    return protection.active(player);
  }

  private boolean ordinary(Entity mob) {
    return mob instanceof Enemy
        && !(mob instanceof Boss)
        && !mob.getPersistentDataContainer().has(MobKeys.ARENA_ENTITY)
        && !sealed.isSealed(mob.getWorld())
        && config.levels().world(mob.getWorld().getName()).isPresent();
  }

  void reconcile(Entity entity) {
    reconcile(entity, null);
  }

  void refreshLoaded() {
    context
        .plugin()
        .getServer()
        .getWorlds()
        .forEach(world -> world.getLivingEntities().forEach(this::reconcile));
  }

  private void reconcile(Entity entity, @Nullable Player engaged) {
    if (!(entity instanceof LivingEntity mob) || !ordinary(mob) || levels.levelOf(mob).isEmpty())
      return;
    var natural = levels.naturalLevel(mob);
    var level = natural;
    if (engaged != null) {
      var active = active(engaged);
      if (active.isPresent())
        level = config.beginnerLuck().effectiveLevel(natural, active.getAsLong());
    }
    for (var player :
        mob.getWorld().getNearbyPlayers(mob.getLocation(), config.beginnerLuck().radius())) {
      var active = active(player);
      if (active.isPresent())
        level = Math.min(level, config.beginnerLuck().effectiveLevel(natural, active.getAsLong()));
    }
    levels.adjust(mob, level);
  }

  void nearby(@Nullable Location at) {
    if (at == null) return; // A queued join/quit callback may outlive the player's body.
    var radius = config.beginnerLuck().radius();
    at.getWorld().getNearbyEntities(at, radius, radius, radius).forEach(this::reconcile);
  }
}
