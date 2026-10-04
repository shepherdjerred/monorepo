package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.mojang.brigadier.arguments.StringArgumentType;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveTable;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Native factory/goal fixture, only packaged in the offline full-test plugin. */
public final class ArenaFixtures implements Listener {
  private final Set<UUID> cubes = new HashSet<>();
  private final WaveTable table;
  private final org.bukkit.plugin.Plugin storm;
  private final JavaPlugin plugin;

  private ArenaFixtures(JavaPlugin plugin, Path content) {
    this.plugin = plugin;
    storm =
        java.util.Objects.requireNonNull(
            plugin.getServer().getPluginManager().getPlugin("TheStorm"));
    table =
        WaveTable.of(
                ConfigFiles.load(
                    content.resolve("arena/waves.yml"),
                    com.shepherdjerred.thestorm.arena.domain.wave.WaveFile.class))
            .fold(
                value -> value,
                problems -> {
                  throw new IllegalStateException("Invalid fixture waves: " + problems);
                });
  }

  public static void install(JavaPlugin plugin, Path content) {
    var fixtures = new ArenaFixtures(plugin, content);
    plugin.getServer().getPluginManager().registerEvents(fixtures, plugin);
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event ->
                event
                    .registrar()
                    .register(
                        Commands.literal("storm-fixture-cube")
                            .requires(
                                source ->
                                    source.getSender()
                                            instanceof org.bukkit.command.ConsoleCommandSender
                                        || source.getSender()
                                            instanceof
                                            org.bukkit.command.RemoteConsoleCommandSender)
                            .then(
                                Commands.argument("mob", StringArgumentType.word())
                                    .then(
                                        Commands.argument("player", StringArgumentType.word())
                                            .executes(
                                                command -> {
                                                  fixtures.spawn(
                                                      StringArgumentType.getString(command, "mob"),
                                                      StringArgumentType.getString(
                                                          command, "player"));
                                                  command
                                                      .getSource()
                                                      .getSender()
                                                      .sendMessage("Spawned native cube.");
                                                  return 1;
                                                })))
                            .build()));
  }

  private void spawn(String mob, String name) {
    var player = java.util.Objects.requireNonNull(plugin.getServer().getPlayerExact(name));
    var cube =
        ArenaNativeProbe.cube(
            storm,
            table,
            new ArenaNativeProbe.Cube(
                mob,
                java.util.Objects.requireNonNull(player.getLocation()).add(10, 0, 0),
                player,
                java.time.InstantSource.system()));
    cubes.add(cube.getUniqueId());
    plugin
        .getServer()
        .getScheduler()
        .runTaskTimer(
            plugin,
            task -> {
              if (!cube.isValid() || !player.isOnline()) {
                task.cancel();
                return;
              }
              ArenaNativeProbe.pursue(cube, player);
              var path = cube.getPathfinder().findPath(player);
              plugin
                  .getLogger()
                  .info(
                      "Cube probe: "
                          + cube.getLocation()
                          + "; target="
                          + cube.getTarget()
                          + "; path="
                          + (path == null ? "none" : path.getPoints().size())
                          + "; onGround="
                          + cube.isOnGround()
                          + "; running="
                          + plugin.getServer().getMobGoals().getRunningGoals(cube).stream()
                              .map(goal -> goal.getKey().toString())
                              .toList());
            },
            20,
            20);
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void contact(EntityDamageByEntityEvent event) {
    if (cubes.contains(event.getDamager().getUniqueId())
        && event.getEntity() instanceof org.bukkit.entity.Player player)
      player.sendMessage("Fixture cube made a native contact attack.");
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void interacted(org.bukkit.event.player.PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (block != null
        && block.getX() >= 1712
        && block.getX() <= 1871
        && block.getZ() >= 2128
        && block.getZ() <= 2287)
      plugin
          .getLogger()
          .info(
              "Interaction probe: "
                  + event.getPlayer().getLocation()
                  + "; block="
                  + block.getLocation()
                  + "; action="
                  + event.getAction()
                  + "; hand="
                  + event.getHand()
                  + "; result="
                  + event.useInteractedBlock());
  }
}
