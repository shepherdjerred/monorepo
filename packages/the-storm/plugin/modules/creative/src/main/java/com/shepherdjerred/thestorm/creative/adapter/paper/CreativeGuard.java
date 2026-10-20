package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.ExperienceOrb;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntitySpawnEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerExpChangeEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;

/**
 * Keeps a creative visit inside the creative world. Experience orbs and experience changes do not
 * count, and a death respawns here instead of at a survival bed.
 */
public final class CreativeGuard implements Listener {

  private static final String LABEL = "Creative";

  private final CreativeSessions sessions;
  private final String world;

  public CreativeGuard(CreativeSessions sessions, String world) {
    this.sessions = sessions;
    this.world = world;
  }

  @EventHandler
  void join(PlayerJoinEvent event) {
    if (Humans.isHuman(event.getPlayer())) {
      sessions.joined(event.getPlayer());
    }
  }

  @EventHandler
  void quit(PlayerQuitEvent event) {
    if (Humans.isHuman(event.getPlayer())) {
      sessions.quit(event.getPlayer());
    }
  }

  @EventHandler
  void exp(PlayerExpChangeEvent event) {
    if (inside(event.getPlayer())) {
      event.setAmount(0);
    }
  }

  @EventHandler
  void orb(EntitySpawnEvent event) {
    if (event.getEntity() instanceof ExperienceOrb
        && world.equals(event.getEntity().getWorld().getName())) {
      event.setCancelled(true);
    }
  }

  @EventHandler
  void death(PlayerDeathEvent event) {
    if (!inside(event.getPlayer())) {
      return;
    }
    event.setKeepInventory(true);
    event.setKeepLevel(true);
    event.getDrops().clear();
    event.setDroppedExp(0);
    event.setShouldDropExperience(false);
    sessions.died(event.getPlayer());
  }

  @EventHandler
  void respawn(PlayerRespawnEvent event) {
    var player = event.getPlayer();
    var destination = player.getServer().getWorld(world);
    if (destination != null && sessions.diedInCreative(player.getUniqueId())) {
      event.setRespawnLocation(CreativeBodies.spawn(destination));
    }
    sessions.respawned(player);
  }

  @EventHandler
  void teleport(PlayerTeleportEvent event) {
    var from = event.getFrom().getWorld();
    var destination = event.getTo();
    var to = destination == null ? null : destination.getWorld();
    if (from == null || to == null || from.equals(to)) {
      return;
    }
    var crosses = world.equals(from.getName()) || world.equals(to.getName());
    if (!crosses || sessions.allowsCross(event.getPlayer().getUniqueId())) {
      return;
    }
    event.setCancelled(true);
    event
        .getPlayer()
        .sendMessage(
            HouseStyle.error(LABEL, Component.text("Use /creative leave to exit creative.")));
  }

  private boolean inside(Player player) {
    var current = player.getWorld();
    return world.equals(current.getName());
  }
}
