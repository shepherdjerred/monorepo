package com.shepherdjerred.thestorm.core.players;

import java.util.EnumSet;
import java.util.HashMap;
import java.util.Map;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.server.PluginDisableEvent;
import org.bukkit.plugin.Plugin;

/**
 * Composes independent module hides before changing Paper's per-plugin visibility. Main thread
 * only.
 */
public final class PlayerVisibilityControl implements Listener, AutoCloseable {
  public enum Reason {
    STAFF,
    COMBAT,
    SPECTATOR
  }

  private record View(Player viewer, Player target) {}

  private final Plugin plugin;
  private final Map<View, EnumSet<Reason>> hidden = new HashMap<>();
  private boolean closed;

  public PlayerVisibilityControl(Plugin plugin) {
    this.plugin = plugin;
    plugin.getServer().getPluginManager().registerEvents(this, plugin);
  }

  /** Releases only {@code reason}; another module or another plugin can still hide the pair. */
  public void set(Player viewer, Player target, Reason reason, boolean obscured) {
    if (closed) {
      if (obscured) throw new IllegalStateException("Player visibility is closed");
      return;
    }
    var view = new View(viewer, target);
    if (obscured) {
      var reasons = hidden.computeIfAbsent(view, _ -> EnumSet.noneOf(Reason.class));
      if (reasons.add(reason) && reasons.size() == 1) viewer.hideEntity(plugin, target);
      return;
    }
    var reasons = hidden.get(view);
    if (reasons != null && reasons.remove(reason) && reasons.isEmpty()) show(view);
  }

  /** A module stops without changing another module's visibility ownership. */
  public void release(Reason reason) {
    for (var view : java.util.List.copyOf(hidden.keySet())) {
      set(view.viewer(), view.target(), reason, false);
    }
  }

  @EventHandler
  public void quit(PlayerQuitEvent event) {
    var player = event.getPlayer();
    for (var view : java.util.List.copyOf(hidden.keySet())) {
      // Paper removes the departing entity and its native hide cache after QuitEvent.
      // A show here would send its hidden profile/tab entry before that removal.
      if (view.viewer().equals(player) || view.target().equals(player)) hidden.remove(view);
    }
  }

  @EventHandler
  public void disabled(PluginDisableEvent event) {
    if (event.getPlugin().equals(plugin)) close();
  }

  private void show(View view) {
    hidden.remove(view);
    view.viewer().showEntity(plugin, view.target());
  }

  @Override
  public void close() {
    if (closed) return;
    for (var view : java.util.List.copyOf(hidden.keySet())) show(view);
    closed = true;
    HandlerList.unregisterAll(this);
  }
}
