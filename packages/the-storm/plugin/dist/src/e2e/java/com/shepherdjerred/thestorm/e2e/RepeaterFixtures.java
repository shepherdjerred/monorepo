package com.shepherdjerred.thestorm.e2e;

import com.mojang.brigadier.arguments.StringArgumentType;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.event.player.PlayerStopUsingItemEvent;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.entity.Arrow;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.ProjectileLaunchEvent;
import org.bukkit.event.player.PlayerItemHeldEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/** Observes genuine held-use packets on the offline test server; never drives the weapon. */
final class RepeaterFixtures implements Listener {
  private record Shot(long elapsedMs, int tick, int arrows) {
    String json() {
      return "{\"elapsedMs\":" + elapsedMs + ",\"tick\":" + tick + ",\"arrows\":" + arrows + "}";
    }
  }

  private record Stopped(int tick, int arrows, int shots) {
    String json() {
      return "{\"tick\":" + tick + ",\"arrows\":" + arrows + ",\"shots\":" + shots + "}";
    }
  }

  private static final class Observation {
    final int initialArrows;
    final List<Shot> shots = new ArrayList<>();
    long firstShotNanos;
    @Nullable Stopped release;
    @Nullable Stopped switched;

    Observation(Player player) {
      initialArrows = arrows(player);
    }

    long elapsedMs() {
      return shots.isEmpty() ? 0 : (System.nanoTime() - firstShotNanos) / 1_000_000;
    }

    String json(Player player) {
      return "{\"initialArrows\":"
          + initialArrows
          + ",\"elapsedMs\":"
          + elapsedMs()
          + ",\"tick\":"
          + Bukkit.getCurrentTick()
          + ",\"arrows\":"
          + arrows(player)
          + ",\"handRaised\":"
          + player.isHandRaised()
          + ",\"shots\":["
          + String.join(",", shots.stream().map(Shot::json).toList())
          + "],\"release\":"
          + (release == null ? "null" : release.json())
          + ",\"switched\":"
          + (switched == null ? "null" : switched.json())
          + "}";
    }

    Stopped stopped(Player player) {
      return new Stopped(Bukkit.getCurrentTick(), arrows(player), shots.size());
    }
  }

  private final Map<UUID, Observation> observations = new HashMap<>();

  static void install(JavaPlugin plugin) {
    var fixture = new RepeaterFixtures();
    plugin.getServer().getPluginManager().registerEvents(fixture, plugin);
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event ->
                event
                    .registrar()
                    .register(
                        Commands.literal("storm-fixture-repeater")
                            .requires(
                                source -> source.getSender() instanceof RemoteConsoleCommandSender)
                            .then(
                                Commands.argument("action", StringArgumentType.word())
                                    .then(
                                        Commands.argument("player", StringArgumentType.word())
                                            .executes(
                                                command -> {
                                                  var player =
                                                      Objects.requireNonNull(
                                                          plugin
                                                              .getServer()
                                                              .getPlayerExact(
                                                                  StringArgumentType.getString(
                                                                      command, "player")));
                                                  command
                                                      .getSource()
                                                      .getSender()
                                                      .sendMessage(
                                                          fixture.command(
                                                              player,
                                                              StringArgumentType.getString(
                                                                  command, "action")));
                                                  return 1;
                                                })))
                            .build()));
  }

  private String command(Player player, String action) {
    var id = player.getUniqueId();
    return switch (action) {
      case "start" -> {
        var observation = new Observation(player);
        observations.put(id, observation);
        yield observation.json(player);
      }
      case "read" -> Objects.requireNonNull(observations.get(id)).json(player);
      case "clear" -> {
        observations.remove(id);
        yield "Cleared Repeater observation.";
      }
      default -> throw new IllegalArgumentException("Unknown Repeater fixture action " + action);
    };
  }

  private static int arrows(Player player) {
    int count = 0;
    for (var item : player.getInventory().getStorageContents())
      if (item != null && item.getType() == Material.ARROW) count += item.getAmount();
    return count;
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void launched(ProjectileLaunchEvent event) {
    if (!(event.getEntity() instanceof Arrow arrow)
        || !(arrow.getShooter() instanceof Player player)) return;
    var observation = observations.get(player.getUniqueId());
    if (observation == null) return;
    if (observation.shots.isEmpty()) observation.firstShotNanos = System.nanoTime();
    observation.shots.add(
        new Shot(observation.elapsedMs(), Bukkit.getCurrentTick(), arrows(player)));
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void released(PlayerStopUsingItemEvent event) {
    var observation = observations.get(event.getPlayer().getUniqueId());
    if (observation != null && observation.release == null)
      observation.release = observation.stopped(event.getPlayer());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void switched(PlayerItemHeldEvent event) {
    var observation = observations.get(event.getPlayer().getUniqueId());
    if (observation != null && observation.switched == null)
      observation.switched = observation.stopped(event.getPlayer());
  }
}
