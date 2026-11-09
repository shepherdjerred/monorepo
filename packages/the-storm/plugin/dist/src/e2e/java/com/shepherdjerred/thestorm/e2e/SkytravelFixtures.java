package com.shepherdjerred.thestorm.e2e;

import com.mojang.brigadier.arguments.StringArgumentType;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.entity.Chicken;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import tools.jackson.databind.json.JsonMapper;

/** Native observations and setup for disposable clients; never packaged into the gameplay jar. */
final class SkytravelFixtures {
  private static final String TAG = "skytravel-probe";

  private SkytravelFixtures() {}

  static void install(JavaPlugin plugin) {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event ->
                event
                    .registrar()
                    .register(
                        Commands.literal("skytravelprobe")
                            .requires(source ->
                                source.getSender() instanceof ConsoleCommandSender
                                    || source.getSender() instanceof RemoteConsoleCommandSender)
                            .then(
                                Commands.argument("action", StringArgumentType.word())
                                    .then(
                                        Commands.argument("player", StringArgumentType.word())
                                            .executes(context ->
                                                execute(
                                                    plugin,
                                                    context.getSource().getSender(),
                                                    StringArgumentType.getString(context, "action"),
                                                    StringArgumentType.getString(
                                                        context, "player")))))
                            .build()));
  }

  private static int execute(JavaPlugin plugin, CommandSender sender, String action, String name) {
    if (!name.matches("BeaconPilot[1-8]|TowerGuardTest"))
      throw new IllegalArgumentException("Only synthetic acceptance clients are allowed");
    var player = Objects.requireNonNull(plugin.getServer().getPlayerExact(name));
    switch (action) {
      case "respawn" -> player.spigot().respawn();
      case "passenger" -> passenger(player);
      case "vehicle" -> vehicle(player);
      case "dismount" -> dismount(player);
      case "state" ->
          sender.sendMessage(Component.text(new JsonMapper().writeValueAsString(state(player))));
      default -> throw new IllegalArgumentException("Unknown Skylands acceptance action");
    }
    return 1;
  }

  private static void passenger(Player player) {
    var passenger = player.getWorld().spawn(player.getLocation(), Chicken.class);
    passenger.setAI(false);
    passenger.setGravity(false);
    passenger.addScoreboardTag(TAG);
    if (!player.addPassenger(passenger)) throw new IllegalStateException("Passenger setup failed");
  }

  private static void vehicle(Player player) {
    var vehicle = player.getWorld().spawnEntity(player.getLocation(), EntityType.OAK_BOAT);
    vehicle.addScoreboardTag(TAG);
    if (!vehicle.addPassenger(player)) throw new IllegalStateException("Vehicle setup failed");
  }

  private static void dismount(Player player) {
    var vehicle = player.getVehicle();
    player.leaveVehicle();
    if (vehicle != null && vehicle.getScoreboardTags().contains(TAG)) vehicle.remove();
    for (var passenger : player.getPassengers())
      if (passenger.getScoreboardTags().contains(TAG)) passenger.remove();
  }

  private static Map<String, Object> state(Player player) {
    var at = player.getLocation();
    return Map.of(
        "player",
        player.getName(),
        "world",
        player.getWorld().getName(),
        "position",
        List.of(at.x(), at.y(), at.z()),
        "health",
        player.getHealth(),
        "gliding",
        player.isGliding(),
        "grounded",
        ((Entity) player).isOnGround(),
        "allowFlight",
        player.getAllowFlight(),
        "flying",
        player.isFlying(),
        "gameMode",
        player.getGameMode().name(),
        "passengers",
        player.getPassengers().size());
  }
}
