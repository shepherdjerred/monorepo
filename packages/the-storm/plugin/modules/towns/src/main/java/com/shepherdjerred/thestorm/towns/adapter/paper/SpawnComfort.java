package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import java.util.Set;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityExhaustionEvent;
import org.bukkit.event.entity.FoodLevelChangeEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.jspecify.annotations.Nullable;

/**
 * Restored spawn towns keep a player fed and a little quicker: the 2015 and 2016 archive spawn
 * sites, and only those. Food and saturation stay full while they stand there, so the bar does not
 * shake. Speed II and Jump Boost I are applied as infinite, particle-free effects and removed on
 * the way out, leaving a potion the player already had alone.
 */
final class SpawnComfort implements Listener {

  private static final int FULL = 20;
  private static final int SPEED = 1;
  private static final int JUMP = 0;

  private final TownsState state;
  private final Set<String> spawnSites;

  SpawnComfort(TownsState state, Set<String> spawnSites) {
    this.state = state;
    this.spawnSites = Set.copyOf(spawnSites);
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onMove(PlayerMoveEvent event) {
    if (event.hasChangedBlock()) {
      refresh(event.getPlayer(), event.getTo());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onTeleport(PlayerTeleportEvent event) {
    refresh(event.getPlayer(), event.getTo());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onRespawn(PlayerRespawnEvent event) {
    refresh(event.getPlayer(), event.getRespawnLocation());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onJoin(PlayerJoinEvent event) {
    refresh(event.getPlayer(), event.getPlayer().getLocation());
  }

  /**
   * Sprint, jump and regen spend exhaustion, and exhaustion is what spends saturation. Cancelling
   * it keeps the bar from shaking.
   */
  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onExhaustion(EntityExhaustionEvent event) {
    if (event.getEntity() instanceof Player player
        && Humans.isHuman(player)
        && inside(player.getLocation())) {
      event.setCancelled(true);
      fill(player);
    }
  }

  /** A drop below full is put back, saturation included. Eating while already full is unchanged. */
  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onFood(FoodLevelChangeEvent event) {
    if (event.getEntity() instanceof Player player
        && Humans.isHuman(player)
        && inside(player.getLocation())
        && event.getFoodLevel() < FULL) {
      event.setFoodLevel(FULL);
      fill(player);
    }
  }

  private void refresh(Player player, @Nullable Location at) {
    if (!Humans.isHuman(player)) {
      return;
    }
    if (inside(at)) {
      grant(player);
    } else {
      clear(player);
    }
  }

  private void grant(Player player) {
    fill(player);
    apply(player, PotionEffectType.SPEED, SPEED);
    apply(player, PotionEffectType.JUMP_BOOST, JUMP);
  }

  /** Food 20 and saturation 20. Saturation is what keeps a full hunger bar steady. */
  private static void fill(Player player) {
    player.setFoodLevel(FULL);
    player.setSaturation(FULL);
    player.setExhaustion(0);
  }

  private void clear(Player player) {
    remove(player, PotionEffectType.SPEED, SPEED);
    remove(player, PotionEffectType.JUMP_BOOST, JUMP);
  }

  private static void apply(Player player, PotionEffectType type, int amplifier) {
    var current = player.getPotionEffect(type);
    if (current != null && !ours(current, amplifier)) {
      return;
    }
    player.addPotionEffect(
        new PotionEffect(type, PotionEffect.INFINITE_DURATION, amplifier, false, false, true));
  }

  private static void remove(Player player, PotionEffectType type, int amplifier) {
    var current = player.getPotionEffect(type);
    if (current != null && ours(current, amplifier)) {
      player.removePotionEffect(type);
    }
  }

  /** Infinite, icon visible, no particles: the effect this listener applied. */
  private static boolean ours(PotionEffect effect, int amplifier) {
    return effect.isInfinite()
        && effect.hasIcon()
        && !effect.hasParticles()
        && effect.getAmplifier() == amplifier;
  }

  private boolean inside(@Nullable Location at) {
    if (at == null) {
      return false;
    }
    var world = at.getWorld();
    if (world == null) {
      return false;
    }
    return state.landAt(world.getName(), at.getBlockX(), at.getBlockY(), at.getBlockZ())
            instanceof Land.HeritageLand heritage
        && spawnSites.contains(heritage.site().id());
  }
}
