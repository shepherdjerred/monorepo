package com.shepherdjerred.thestorm.world.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.world.domain.AmbientConfig;
import com.shepherdjerred.thestorm.world.domain.AmbientRumor;
import java.time.InstantSource;
import java.time.LocalDate;
import java.util.Objects;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/** Speaks once per Pacific day when a player arrives near the main-world windmill spawn. */
public final class AmbientBarks implements Listener {

  private final AmbientConfig config;
  private final InstantSource time;
  private final NamespacedKey heardDay;

  public AmbientBarks(Plugin plugin, AmbientConfig config, InstantSource time) {
    if (plugin.getServer().getWorld(config.world()) == null) {
      throw new IllegalStateException("ambient world is not loaded: " + config.world());
    }
    this.config = config;
    this.time = time;
    this.heardDay = new NamespacedKey(plugin, "ambient_bark_day");
  }

  @EventHandler
  public void onJoin(PlayerJoinEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    announce(
        event.getPlayer(),
        requireNonNull(event.getPlayer().getLocation(), "joining player has no location"));
  }

  @EventHandler
  public void onWorldChange(PlayerChangedWorldEvent event) {
    announce(
        event.getPlayer(),
        requireNonNull(event.getPlayer().getLocation(), "travelling player has no location"));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onMove(PlayerMoveEvent event) {
    var destination = event.getTo();
    if (destination == null || sameBlock(event.getFrom(), destination)) {
      return;
    }
    if (!nearSpawn(event.getFrom())) {
      announce(event.getPlayer(), destination);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onTeleport(PlayerTeleportEvent event) {
    var destination = event.getTo();
    if (destination != null && !nearSpawn(event.getFrom())) {
      announce(event.getPlayer(), destination);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onRespawn(PlayerRespawnEvent event) {
    announce(event.getPlayer(), event.getRespawnLocation());
  }

  private void announce(Player player, Location destination) {
    if (!nearSpawn(destination)) {
      return;
    }
    var today = LocalDate.ofInstant(time.instant(), config.zone()).toEpochDay();
    var data = player.getPersistentDataContainer();
    if (data.has(heardDay) && !data.has(heardDay, PersistentDataType.LONG)) {
      throw new IllegalStateException(
          "invalid ambient bark day for player " + player.getUniqueId());
    }
    var previous = data.get(heardDay, PersistentDataType.LONG);
    if (previous != null && previous == today) {
      return;
    }
    var world = destination.getWorld();
    if (world == null) {
      throw new IllegalStateException("ambient destination has no world");
    }
    var rumor = AmbientRumor.atSpawn(today, world.hasStorm(), world.isThundering());
    data.set(heardDay, PersistentDataType.LONG, today);
    player.sendMessage(Component.text(rumor, NamedTextColor.GOLD));
  }

  private boolean nearSpawn(Location location) {
    var world = location.getWorld();
    if (world == null || !world.getName().equals(config.world())) {
      return false;
    }
    long east = (long) location.getBlockX() - config.spawnX();
    long up = (long) location.getBlockY() - config.spawnY();
    long south = (long) location.getBlockZ() - config.spawnZ();
    if (Math.abs(east) > config.spawnRadius()
        || Math.abs(south) > config.spawnRadius()
        || Math.abs(up) > config.verticalRadius()) {
      return false;
    }
    return east * east + south * south <= (long) config.spawnRadius() * config.spawnRadius();
  }

  private static boolean sameBlock(Location a, Location b) {
    return Objects.equals(a.getWorld(), b.getWorld())
        && a.getBlockX() == b.getBlockX()
        && a.getBlockY() == b.getBlockY()
        && a.getBlockZ() == b.getBlockZ();
  }
}
