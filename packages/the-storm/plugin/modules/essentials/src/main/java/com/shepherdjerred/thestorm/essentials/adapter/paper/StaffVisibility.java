package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.players.PlayerVisibility;
import com.shepherdjerred.thestorm.essentials.app.StaffState;
import com.shepherdjerred.thestorm.essentials.app.StaffStore;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/** Persistent vanish and session accounting. Never treats Citizens bodies as players. */
final class StaffVisibility implements Listener {
  private final StaffCommands tools;
  private final Map<UUID, Instant> joined = new HashMap<>();

  StaffVisibility(StaffCommands tools) {
    this.tools = tools;
  }

  void register() {
    tools.permission("vanish.see");
    tools.add(
        "vanish",
        request -> {
          var player = request.self();
          var hidden = !PlayerVisibility.hidden(player);
          var session = snapshot(player, hidden);
          request.save(
              List.of(tools.state.entry("session", player.getUniqueId().toString(), session)),
              () -> {
                joined.put(player.getUniqueId(), session.seen());
                set(player, hidden);
                request.say("Vanish: " + hidden);
              });
        });
    tools.add(
        "seen <username>",
        request -> {
          var sessions =
              tools.state.keys("session").stream()
                  .map(
                      id -> tools.state.find("session", id, StaffState.Session.class).orElseThrow())
                  .filter(session -> session.name().equalsIgnoreCase(request.word(0)))
                  .toList();
          if (sessions.isEmpty())
            throw new IllegalArgumentException("No session has been recorded for that username.");
          request.say(sessions.getFirst().name() + " last seen " + sessions.getFirst().seen());
        });
    tools.add(
        "whois <player>",
        request -> {
          var player = tools.player(request.actor(), request.word(0));
          request.say(
              player.getName()
                  + " "
                  + player.getUniqueId()
                  + " mode="
                  + player.getGameMode()
                  + " world="
                  + player.getWorld().getName()
                  + " vanished="
                  + PlayerVisibility.hidden(player));
        });
    tools.add(
        "near [radius]",
        request -> {
          var self = request.self();
          int radius = request.words().length == 0 ? 100 : request.number(0, 1, 1000);
          var names =
              self.getWorld().getPlayers().stream()
                  .filter(
                      player ->
                          PlayerVisibility.visibleTo(self, player)
                              && Positions.current(player).distanceSquared(Positions.current(self))
                                  <= (double) radius * radius)
                  .map(Player::getName)
                  .toList();
          request.say("Nearby: " + String.join(", ", names));
        });
  }

  private StaffState.Session snapshot(Player player, boolean hidden) {
    var id = player.getUniqueId();
    var now = tools.context.time().instant();
    long past =
        tools
            .state
            .find("session", id.toString(), StaffState.Session.class)
            .map(StaffState.Session::playMillis)
            .orElse(0L);
    var start = joined.get(id);
    return new StaffState.Session(
        player.getName(),
        Positions.of(player),
        now,
        past + (start == null ? 0 : Math.max(0, Duration.between(start, now).toMillis())),
        hidden);
  }

  private void set(Player player, boolean hidden) {
    PlayerVisibility.set(player, hidden);
    for (var viewer : tools.context.plugin().getServer().getOnlinePlayers()) {
      if (PlayerVisibility.visibleTo(viewer, player))
        viewer.showPlayer(tools.context.plugin(), player);
      else viewer.hidePlayer(tools.context.plugin(), player);
    }
  }

  void sweep() {
    tools.context.plugin().getServer().getOnlinePlayers().forEach(this::refreshFlag);
    for (var player : tools.context.plugin().getServer().getOnlinePlayers()) {
      if (PlayerVisibility.hidden(player) && !player.hasPermission("thestorm.essentials.vanish"))
        set(player, false);
      for (var other : tools.context.plugin().getServer().getOnlinePlayers()) {
        if (PlayerVisibility.hidden(other) && !PlayerVisibility.visibleTo(player, other))
          player.hidePlayer(tools.context.plugin(), other);
        else player.showPlayer(tools.context.plugin(), other);
      }
    }
  }

  private void refreshFlag(Player player) {
    if (!PlayerVisibility.hidden(player)) return;
    var _ =
        tools
            .context
            .services()
            .require(com.shepherdjerred.thestorm.core.expansion.ManagedGameplay.class)
            .enabled(
                com.shepherdjerred.thestorm.core.expansion.ManagedGameplay.STAFF,
                player.getUniqueId())
            .whenCompleteAsync(
                (enabled, failure) -> {
                  if (PlayerVisibility.hidden(player)
                      && (failure != null
                          || !Boolean.TRUE.equals(enabled)
                          || !player.hasPermission("thestorm.essentials.vanish")))
                    set(player, false);
                },
                tools.context.scheduler().mainThread());
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void join(PlayerJoinEvent event) {
    var player = event.getPlayer();
    if (!Humans.isHuman(player)) return;
    joined.put(player.getUniqueId(), tools.context.time().instant());
    if (tools.state.ready()) {
      var hidden =
          tools
              .state
              .find("session", player.getUniqueId().toString(), StaffState.Session.class)
              .map(StaffState.Session::vanished)
              .orElseGet(() -> PlayerVisibility.hidden(player));
      set(player, false);
      var _ =
          tools
              .context
              .services()
              .require(com.shepherdjerred.thestorm.core.expansion.ManagedGameplay.class)
              .enabled(
                  com.shepherdjerred.thestorm.core.expansion.ManagedGameplay.STAFF,
                  player.getUniqueId())
              .whenCompleteAsync(
                  (enabled, failure) -> {
                    if (player.isOnline())
                      set(
                          player,
                          failure == null
                              && Boolean.TRUE.equals(enabled)
                              && hidden
                              && player.hasPermission("thestorm.essentials.vanish"));
                  },
                  tools.context.scheduler().mainThread());
    }
    if (PlayerVisibility.hidden(player)) event.joinMessage(null);
    sweep();
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void quit(PlayerQuitEvent event) {
    var player = event.getPlayer();
    if (!Humans.isHuman(player) || !tools.state.ready()) return;
    if (PlayerVisibility.hidden(player)) event.quitMessage(null);
    var entry =
        tools.state.entry(
            "session",
            player.getUniqueId().toString(),
            snapshot(player, PlayerVisibility.hidden(player)));
    var _ =
        tools
            .state
            .commit(
                List.of(entry),
                new StaffStore.Audit(
                    "system",
                    "logout",
                    player.getUniqueId().toString(),
                    tools.context.time().instant()))
            .exceptionally(
                failure -> {
                  tools.context.logger().error("Could not record logout", failure);
                  return null;
                });
    joined.remove(player.getUniqueId());
  }
}
