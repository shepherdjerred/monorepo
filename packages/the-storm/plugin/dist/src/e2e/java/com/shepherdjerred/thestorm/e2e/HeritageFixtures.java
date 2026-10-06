package com.shepherdjerred.thestorm.e2e;

import com.mojang.brigadier.arguments.StringArgumentType;
import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.core.protection.Protection;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.Objects;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.plugin.java.JavaPlugin;

/** Native death acceptance on the offline disposable server; never included in the gameplay jar. */
final class HeritageFixtures {
  private HeritageFixtures() {}

  static void install(JavaPlugin plugin) {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event ->
                event
                    .registrar()
                    .register(
                        Commands.literal("heritagefixture")
                            .requires(
                                source ->
                                    source.getSender() instanceof ConsoleCommandSender
                                        || source.getSender() instanceof RemoteConsoleCommandSender)
                            .then(
                                Commands.literal("death")
                                    .then(
                                        Commands.argument("player", StringArgumentType.word())
                                            .executes(
                                                context -> {
                                                  var player =
                                                      Objects.requireNonNull(
                                                          plugin
                                                              .getServer()
                                                              .getPlayerExact(
                                                                  StringArgumentType.getString(
                                                                      context, "player")));
                                                  var storm =
                                                      (TheStormPlugin)
                                                          Objects.requireNonNull(
                                                              plugin
                                                                  .getServer()
                                                                  .getPluginManager()
                                                                  .getPlugin("TheStorm"));
                                                  if (!storm
                                                      .service(Protection.class)
                                                      .isPreserved(player.getLocation())) {
                                                    throw new IllegalStateException(
                                                        "Death fixture requires preserved land");
                                                  }
                                                  // Direct native death bypasses Safe land's damage
                                                  // cancellation. Paper still
                                                  // dispatches the real death event and performs
                                                  // vanilla inventory/XP handling.
                                                  player.setHealth(0);
                                                  return 1;
                                                })))
                            .build()));
  }
}
