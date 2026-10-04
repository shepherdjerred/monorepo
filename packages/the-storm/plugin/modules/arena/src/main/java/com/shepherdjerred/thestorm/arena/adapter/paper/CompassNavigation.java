package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.permissions.PermissionAttachment;

/** Explicit tool denials also override operator defaults, scoped to protected arena footprints. */
final class CompassNavigation implements Listener {
  private final Arenas arenas;
  private final org.bukkit.plugin.Plugin plugin;
  private final Map<UUID, PermissionAttachment> denied = new HashMap<>();

  CompassNavigation(Arenas arenas, org.bukkit.plugin.Plugin plugin) {
    this.arenas = arenas;
    this.plugin = plugin;
    plugin.getServer().getOnlinePlayers().forEach(p -> update(p, Places.at(p)));
  }

  private void update(Player player, Location at) {
    if (arenas.all().stream().anyMatch(r -> r.world().contains(at))) {
      denied.computeIfAbsent(
          player.getUniqueId(),
          _ -> {
            var attachment = player.addAttachment(plugin);
            attachment.setPermission("worldedit.navigation.jumpto.tool", false);
            attachment.setPermission("worldedit.navigation.thru.tool", false);
            return attachment;
          });
    } else remove(player.getUniqueId());
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void interact(PlayerInteractEvent event) {
    update(event.getPlayer(), Places.at(event.getPlayer()));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void move(PlayerMoveEvent event) {
    update(event.getPlayer(), event.getTo());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void teleport(PlayerTeleportEvent event) {
    if (event.getTo() != null) update(event.getPlayer(), event.getTo());
  }

  @EventHandler
  void quit(PlayerQuitEvent event) {
    remove(event.getPlayer().getUniqueId());
  }

  private void remove(UUID id) {
    var attachment = denied.remove(id);
    if (attachment != null) attachment.remove();
  }

  void stop() {
    java.util.List.copyOf(denied.keySet()).forEach(this::remove);
  }
}
