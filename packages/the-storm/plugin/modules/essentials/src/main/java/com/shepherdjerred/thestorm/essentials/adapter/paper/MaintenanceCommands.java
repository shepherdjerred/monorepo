package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;
import static io.papermc.paper.command.brigadier.Commands.argument;
import static io.papermc.paper.command.brigadier.Commands.literal;

import com.shepherdjerred.thestorm.core.players.Humans;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.event.connection.PlayerConnectionValidateLoginEvent;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

/** Closes player admission atomically with an empty-server check on Paper's main thread. */
final class MaintenanceCommands implements Listener {

  private final PaperRuntime runtime;
  private Optional<String> owner = Optional.empty();

  MaintenanceCommands(PaperRuntime runtime) {
    this.runtime = runtime;
  }

  void register(Commands commands) {
    var command =
        literal("storm-maintenance")
            .requires(
                source ->
                    source.getSender() instanceof ConsoleCommandSender
                        || source.getSender() instanceof RemoteConsoleCommandSender);
    for (var action : new String[] {"begin", "end"}) {
      command.then(
          literal(action)
              .then(
                  argument("owner", word())
                      .executes(
                          context -> {
                            var requested = getString(context, "owner");
                            if (!requested.matches("[a-z0-9-]{1,64}")) {
                              throw new IllegalArgumentException(
                                  "maintenance owner must be 1-64 lowercase letters, digits or hyphens");
                            }
                            return change(context.getSource().getSender(), action, requested);
                          })));
    }
    commands.register(command.build(), "Console-only empty-server maintenance admission");
  }

  private int change(CommandSender sender, String action, String requested) {
    var players = runtime.server().getOnlinePlayers().stream().filter(Humans::isHuman).count();
    String state;
    if (owner.isPresent() && !owner.get().equals(requested)) {
      state = "conflict";
    } else if (action.equals("end")) {
      owner = Optional.empty();
      state = "open";
    } else if (players != 0) {
      state = "occupied";
    } else {
      owner = Optional.of(requested);
      state = "ready";
    }
    sender.sendMessage(
        Component.text(
            "{\"schemaVersion\":1,\"owner\":\""
                + requested
                + "\",\"state\":\""
                + state
                + "\",\"players\":"
                + players
                + "}"));
    return 1;
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void onLogin(PlayerConnectionValidateLoginEvent event) {
    if (owner.isPresent()) {
      event.kickMessage(
          Component.text("The Storm is undergoing maintenance. Please try again shortly."));
    }
  }
}
